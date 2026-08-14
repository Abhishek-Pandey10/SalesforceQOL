"""
apex_parser.py - Heuristic reference extraction for a single Apex file.

There is no lightweight Apex compiler/AST available, so this is a
regex + brace-depth heuristic over the raw text, not a real parser. It:

  1. Blanks out string literals and comments (keeping length/newlines intact
     so line numbers stay correct) so they can't produce false-positive
     matches.
  2. Finds the file's top-level type declaration (class/interface/trigger,
     plus extends/implements) via a regex on the (now comment/string-free)
     header text.
  3. Walks brace depth once to find every top-level method's [start, end)
     character span and name, so any reference found inside a span can be
     attributed to "called from methodName()".
  4. Does a single token-scan pass over the whole file; any identifier that
     matches a name in the whole-org symbol table becomes a reference,
     classified by what immediately precedes/follows it (new X(, X.member(,
     X.member, extends/implements already handled in step 2, instanceof X,
     otherwise a bare type reference).

Known limitations (surfaced in the README, not hidden): this cannot resolve
fully-qualified managed-package names, or `Type.forName` calls whose class
name isn't a literal string right there in the call (the common
custom-metadata-driven-factory pattern reads the name from a field at
runtime, which is unresolvable by construction) - it only catches direct
textual references to classes that exist in the scanned org, plus the one
`Type.forName('LiteralClassName')` single-argument literal form (see
parse_apex_file's dynamic_instantiation handling; the namespaced two-argument
overload `Type.forName(ns, name)` is deliberately left unresolved rather than
misread). Overloads and polymorphism get a best-effort treatment (see
find_method_spans' arity/is_override and graph_builder's possible_override
edges) rather than being silently ignored, but neither is real type
resolution: same-arity overloads with different parameter *types* still
collapse onto one method node, and override-edge fan-out is generated for
every `override` method in the hierarchy regardless of whether the call
site could actually receive that subtype.

Same-class calls (`checkPermission(x)` / `this.checkPermission(x)`, no
receiver naming another type) are resolved directly against this class's own
declared methods (self_method_names in parse_apex_file) - deliberately
scoped to methods declared directly on this type, not ones only inherited
from a superclass without being redeclared here. A bare/`this.`-qualified
call to an *inherited* method resolving to the superclass isn't attempted -
that needs the same base-class lookup graph_builder's polymorphism handling
does, which this per-file parse has no visibility into. Also, such a call is
always resolved to this exact class's own method (kind="self_call") without
polymorphic fan-out, even for a `virtual` method that a subclass overrides -
a subclass instance executing inherited base-class code that calls
`this.virtualMethod()` really would dispatch to the subclass's override at
runtime, which this parser doesn't attempt to model for the implicit-`this`
case (it does for an explicit variable of a declared type - see
graph_builder's possible_override edges).

`super.method(x)` is resolved too, but separately from the above: it targets
this type's own `extends` base class directly (a real, single-hop lookup, not
the "not attempted" inherited-bare-call gap described above), non-virtually
and with no polymorphic fan-out - `super.x()` always calls the exact base
implementation, never a further override. And a *nested* type's bare call to
its *enclosing* type's method (`helper()` instead of `Outer.helper()`, legal
Apex - see enclosing_method_owner in parse_apex_file) is resolved against the
enclosing type's own methods, one lexical scope out from self_method_names.
"""
from __future__ import annotations

import re
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from backend.models import Occurrence

_NON_METHOD_WORDS = {
    "if", "for", "while", "switch", "catch", "try", "else", "finally", "do",
    "class", "interface", "trigger", "enum", "return", "new", "synchronized",
}

_TYPE_HEADER_RE = re.compile(
    r"\b(class|interface|trigger)\s+(\w+)\b(.*?)\{", re.IGNORECASE | re.DOTALL
)
_TRIGGER_ON_RE = re.compile(r"\bon\s+(\w+)\s*\(", re.IGNORECASE)
# Bug fix: this used to capture only `[\w.]+` after `extends`, which (like
# the old `implements` regex below) stops at the first comma - so
# `interface Combo extends Runnable, Loggable` silently dropped `Loggable`
# with no trace in unresolved_reference_count. An Apex *interface* can
# extend several interfaces at once (a *class* can only ever extend one,
# but the parser doesn't need to special-case that - _split_top_level below
# just yields a single-element list for the class case). Captures up to
# `implements` or the end of the header; _simple_type_name/_split_top_level
# do the generic-stripping/comma-splitting, same as `implements`.
_EXTENDS_RE = re.compile(r"\bextends\s+(.+?)(?=\bimplements\b|$)", re.IGNORECASE | re.DOTALL)
# Bug fix: this used to require the *entire* remainder of the header to be
# `[\w\s,]+` (no '.' or '<'/'>'), so a single generic or namespaced entry in
# the list - `implements Database.Batchable<sObject>, Database.Stateful,
# MyOrgInterface` (an extremely common Apex pattern) - failed the match
# outright and silently dropped every entry in the list, not just the one
# that didn't fit, with no trace in unresolved_reference_count either. Now
# it just captures everything up to the '{' and _simple_type_name /
# _split_top_level below do the generic-stripping/comma-splitting.
_IMPLEMENTS_RE = re.compile(r"\bimplements\s+(.+)$", re.IGNORECASE | re.DOTALL)
_IDENT_RE = re.compile(r"[A-Za-z_]\w*")
_METHOD_SIG_RE = re.compile(r"([A-Za-z_]\w*)\s*\(([^()]*)\)\s*$")
_OVERRIDE_RE = re.compile(r"\boverride\b", re.IGNORECASE)

# `Type.forName('ClassName')` - the single-argument literal-string overload
# of Apex's reflection API, commonly used to key a factory off a hardcoded
# class name (or, less resolvably, a Custom Metadata field value - see
# module docstring). Matched against *original_text*, not the comment/
# string-stripped copy - the string literal content is exactly what
# strip_comments_and_strings blanks out. The trailing `\s*\)` requires the
# literal to be the sole argument, so the namespaced two-argument overload
# `Type.forName(ns, name)` - where a looser regex would wrongly capture the
# namespace as if it were the class name - simply doesn't match at all
# rather than resolving to the wrong class.
_TYPE_FORNAME_RE = re.compile(r"""Type\s*\.\s*forName\s*\(\s*['"]([\w.]+)['"]\s*\)""")

# A class is test-only if it carries the @isTest annotation anywhere before
# its declaration (there's no compiler here to resolve annotation targets
# precisely, but for a single top-level type this prefix scan is exact). An
# individual method is a test method either via that same annotation applied
# to just the method, or the older `testMethod` modifier keyword - both are
# checked against the raw signature buffer captured by find_method_spans.
_ISTEST_RE = re.compile(r"@\s*istest\b", re.IGNORECASE)
_TEST_METHOD_RE = re.compile(r"@\s*istest\b|\btestmethod\b", re.IGNORECASE)

# Annotation/modifier markers that make a method a known platform entry
# point - invoked by something outside the parsed org (Lightning/Aura,
# Flow's "Apex Action", REST/SOAP callers, the async executor, a managed
# package's public API), not by another method in-org. Checked in order
# against the same raw signature buffer as _TEST_METHOD_RE/_OVERRIDE_RE, used
# by graph_builder to exclude these from dead-code candidates regardless of
# in_degree. Order matters only for which label wins when a method somehow
# matches more than one (annotations are more specific than the bare
# `global` modifier, so they're checked first).
_AURA_ENABLED_RE = re.compile(r"@\s*AuraEnabled\b", re.IGNORECASE)
_INVOCABLE_METHOD_RE = re.compile(r"@\s*InvocableMethod\b", re.IGNORECASE)
_REMOTE_ACTION_RE = re.compile(r"@\s*RemoteAction\b", re.IGNORECASE)
_FUTURE_RE = re.compile(r"@\s*future\b", re.IGNORECASE)
# Custom REST API endpoints (a class annotated @RestResource, methods
# annotated with one of these) - a genuine external caller, same entry-point
# family as @AuraEnabled/@RemoteAction, just for the REST API instead of
# Lightning/SOAP.
_HTTP_GET_RE = re.compile(r"@\s*HttpGet\b", re.IGNORECASE)
_HTTP_POST_RE = re.compile(r"@\s*HttpPost\b", re.IGNORECASE)
_HTTP_PUT_RE = re.compile(r"@\s*HttpPut\b", re.IGNORECASE)
_HTTP_DELETE_RE = re.compile(r"@\s*HttpDelete\b", re.IGNORECASE)
_HTTP_PATCH_RE = re.compile(r"@\s*HttpPatch\b", re.IGNORECASE)
# Legacy SOAP API exposure - predates @RemoteAction, doesn't itself contain
# the word "global" even though it behaves like one (a webservice method
# implicitly requires its class to be global, but that's a *separate*
# textual token elsewhere in the class declaration, not this method's own
# signature buffer) - without its own check, a webservice method with no
# in-org caller read as dead.
_WEBSERVICE_MODIFIER_RE = re.compile(r"\bwebservice\b", re.IGNORECASE)
_GLOBAL_MODIFIER_RE = re.compile(r"\bglobal\b", re.IGNORECASE)
_ENTRY_POINT_CHECKS: List[Tuple["re.Pattern[str]", str]] = [
    (_AURA_ENABLED_RE, "@AuraEnabled"),
    (_INVOCABLE_METHOD_RE, "@InvocableMethod"),
    (_REMOTE_ACTION_RE, "@RemoteAction"),
    (_FUTURE_RE, "@future"),
    (_HTTP_GET_RE, "@HttpGet"),
    (_HTTP_POST_RE, "@HttpPost"),
    (_HTTP_PUT_RE, "@HttpPut"),
    (_HTTP_DELETE_RE, "@HttpDelete"),
    (_HTTP_PATCH_RE, "@HttpPatch"),
    (_WEBSERVICE_MODIFIER_RE, "webservice modifier"),
    (_GLOBAL_MODIFIER_RE, "global modifier"),
]

# Tokens that can legally precede a method name in its signature buffer
# without being a return type - used by _extract_method_signature to tell a
# constructor (`public Foo(...)`, nothing but modifiers before the name)
# apart from a same-named regular method (`public static Account
# Account(...)` is legal Apex - the returned Account is a *type*, not the
# constructor). Anything left over after stripping these, plus any `@...`
# annotation token, is assumed to be a return type.
_METHOD_MODIFIER_TOKENS = {
    "public", "private", "protected", "global", "static", "final",
    "virtual", "abstract", "override", "testmethod", "webservice",
    "transient",
}

# Matches a bare `Type name` token pair immediately followed by one of the
# characters that ends a declaration (assignment, statement end, next param,
# closing paren of a param/catch list, or the ':' of a for-each loop) - not a
# real parser, just enough to catch `Utility helper = new Utility();` /
# `getFirstContact(Id accountId)` / `catch (MyException e)` style
# declarations without also matching return-type-then-method-name pairs
# (which are always followed by `(`, not one of these) or generics/casts
# (`List<Account>`/`(Type)` break the required whitespace before the name).
_VAR_DECL_RE = re.compile(r"\b([A-Z][A-Za-z0-9_]*)\s+([A-Za-z_]\w*)\s*(?=[=;,):])")
# Additional `, name` siblings in a multi-variable declaration
# (`Utility a, b, c;`) - _VAR_DECL_RE only matches the first `Type name`
# pair, so this picks up each subsequent comma-separated name at the same
# statement. Anchored via re.Match(pos) immediately after the previous name
# (not .search()), so it only fires on a genuine `, name` sibling, not some
# unrelated later comma in the file.
_MORE_DECL_NAME_RE = re.compile(r",\s*([A-Za-z_]\w*)\s*(?=[=;,):])")


def _skip_local_initializer(text: str, pos: int) -> int:
    """If the next non-space char at *pos* is '=' (a variable declaration's
    initializer, e.g. `= new Utility()`), returns the offset of the next
    top-level ','/';'/unmatched-close after it - tracking `()[]{}` nesting
    so a comma inside the initializer's own argument list (`new
    Utility(1, 2)`) isn't mistaken for a multi-declaration separator.
    Returns *pos* unchanged if there's no '=' to skip.

    Bug fix: without this, `_build_local_type_map`'s multi-variable sibling
    walk only worked for the no-initializer form (`Utility a, b;`) - the
    equally common `Utility first = new Utility(), second;` left `second`
    unmapped, because the char immediately after `first` is '=', not ',',
    so the sibling loop never even started."""
    ch, i = _next_non_space(text, pos)
    if ch != "=":
        return pos
    i += 1
    depth = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                return i
            depth -= 1
        elif c in ",;" and depth == 0:
            return i
        i += 1
    return i



# Scope key used by _build_local_type_map / _lookup_local_type for a
# declaration that sits outside every method span (a class-level field) -
# visible from every method, unlike a method-local declaration.
_FIELD_SCOPE = -1


def _build_local_type_map(
    stripped: str, symbol_table: Dict[str, str],
    method_spans: List[MethodSpan],
) -> Dict[int, Dict[str, str]]:
    """Best-effort map of locally-declared names (fields, parameters, local
    variables) to the org type they were declared with, scoped by *enclosing
    method* (keyed by that method's index into *method_spans*, from
    _span_index_at - or _FIELD_SCOPE for a class-level field declaration,
    which every method can see). This is what lets a call *through* a
    variable (`helper.formatDate()`) resolve back to its type (`Utility`)
    even though `helper` itself is never a symbol-table hit - without it,
    the only calls this parser can see are ones spelled with the literal
    class name (`Utility.formatDate()`), which is a small fraction of real
    Apex. Two same-named locals of different types in the *same* scope
    still collide (last declaration wins); accepted, consistent with the
    rest of this file already being regex heuristics rather than a
    compiler.

    Bug fix: this used to be flattened into one class-wide map, so a local
    variable declared in one method (e.g. `AccountService accountService =
    ...;` in method A) leaked into an unrelated method B - a genuine
    `AccountService.getById()` static call in B, whose identifier also
    matches that variable's name case-insensitively (the conventional Apex/
    Java "type name lowercased as the variable name" pattern), was
    misread as a call *through* the variable instead of the literal type,
    misclassifying it as an ambiguous instance_call - which could then
    spuriously trigger possible_override polymorphic-dispatch fan-out for a
    call that was never dispatch-ambiguous at all."""
    scoped: Dict[int, Dict[str, str]] = defaultdict(dict)
    for m in _VAR_DECL_RE.finditer(stripped):
        target_id = symbol_table.get(m.group(1).lower())
        if not target_id:
            continue
        scope_key = _span_index_at(method_spans, m.start())
        scoped[scope_key][m.group(2).lower()] = target_id
        # Multi-variable declaration (`Utility a, b, c;`) - keep pulling
        # `, name` siblings right after the one _VAR_DECL_RE just matched,
        # so `b`/`c` map to the same type instead of being silently
        # unresolvable later (see docstring above). Skip past the first
        # name's own initializer first (`Utility first = new Utility(),
        # second;`), or the sibling walk below would never even start -
        # the char right after `first` is '=', not ',', for that form.
        pos = _skip_local_initializer(stripped, m.end())
        while pos < len(stripped) and stripped[pos] == ",":
            sib = _MORE_DECL_NAME_RE.match(stripped, pos)
            if not sib:
                break
            scoped[scope_key][sib.group(1).lower()] = target_id
            pos = _skip_local_initializer(stripped, sib.end())
    return dict(scoped)


def _lookup_local_type(
    scoped_local_types: Dict[int, Dict[str, str]], scope_key: int, word_lower: str,
) -> Optional[str]:
    """Resolve *word_lower* against its enclosing method's own declarations
    first, falling back to class-level fields (visible from every method) -
    never against a *different* method's locals, which is the scope leak
    _build_local_type_map's docstring describes."""
    hit = scoped_local_types.get(scope_key, {}).get(word_lower)
    if hit is not None:
        return hit
    if scope_key != _FIELD_SCOPE:
        return scoped_local_types.get(_FIELD_SCOPE, {}).get(word_lower)
    return None


def _count_params_arity(params_text: str) -> int:
    """Number of parameters in a method signature's parameter-list text.
    Apex has no default arguments/varargs, so this is just a top-level comma
    count - "top-level" because a generic parameter type
    (`Map<String, Integer> m`) can itself contain a comma that isn't a
    parameter separator; `<...>` nesting (via _split_top_level) is tracked
    to skip those."""
    text = params_text.strip()
    if not text:
        return 0
    return len(_split_top_level(text))


def _looks_like_generic_open(stripped_text: str, lt_pos: int, *, max_lookahead: int = 200) -> bool:
    """Bounded lookahead from a candidate '<' (immediately preceded by an
    identifier char, per _count_call_args' first check) to decide whether it
    really opens a generic type argument list (`Map<Id, Account>`) rather
    than being a `<` comparison operator whose left operand just happens to
    abut it with no space (`counter<max`) - unspaced comparisons like that
    are common enough in real Apex (tight loop/guard conditions) that the
    "conventional style always spaces a comparison operator" assumption this
    used to rely on wasn't safe.

    Scans ahead, tracking nested `<...>` depth, for a matching close before
    hitting a character that can never legally appear inside a type-
    parameter list (an operator, a bare `)`/`}`/`;`, ...) - hitting one of
    those first means this was never a generic to begin with. Bug fix: an
    unmatched `<` used to be assumed a generic unconditionally and left
    angle_depth stuck open for the rest of the argument list, silently
    swallowing every real comma after it - e.g. `save(counter<max, true)`
    (2 real arguments) counted as 1, which could then resolve an overloaded
    call to the wrong sibling overload instead of the one actually called.
    Bounded to max_lookahead so a pathological/unclosed '<' can't turn this
    into a scan to end-of-file."""
    n = min(len(stripped_text), lt_pos + max_lookahead)
    depth = 0
    i = lt_pos
    while i < n:
        ch = stripped_text[i]
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
            if depth == 0:
                return True
            if depth < 0:
                return False
        elif not (ch.isalnum() or ch in " \t\r\n._,[]"):
            return False
        i += 1
    return False


def _count_call_args(stripped_text: str, original_text: str, open_paren_pos: int) -> int:
    """Number of top-level comma-separated arguments in a call's argument
    list, given the offset of its opening '('. Unlike parameter lists, call
    arguments can themselves contain nested calls/collection/set literals
    (`foo(bar(1, 2), new Set<Id>{a, b})`), so `()[]{}` nesting is all
    tracked (over stripped_text, so a comma inside a blanked-out string
    literal isn't mistaken for an argument separator).

    Generic type arguments are also tracked (`foo(new Map<Id, Account>())`
    must not count the comma inside `<Id, Account>` as an argument
    separator - it isn't a nested-bracket case, since the generic's `<>`
    opens *before* the constructor's own `()`). A `<` is only a *candidate*
    generic open if immediately preceded by an identifier character with no
    space (`Map<...`); _looks_like_generic_open then confirms it actually
    closes like one before it's trusted - see that function for why (an
    unspaced comparison, `counter<max`, looks identical to the candidate
    check alone). Not foolproof (heuristic parser throughout, not a real
    one - see module docstring), but no longer trusts an unmatched `<` on
    sight.

    Whether *anything* was passed at all (`foo()` vs `foo('x')`) has to be
    checked against original_text, not stripped_text: strip_comments_and_
    strings blanks a string literal's contents down to plain spaces, so a
    lone string-literal argument like `foo('hello')` would otherwise look
    identical to an empty call and get miscounted as zero arguments."""
    i = open_paren_pos + 1
    n = len(stripped_text)
    depth = 0
    angle_depth = 0
    saw_token = False
    count = 0
    while i < n:
        ch = stripped_text[i]
        if ch == "<" and angle_depth == 0:
            prev = stripped_text[i - 1] if i > 0 else ""
            if (prev.isalnum() or prev == "_") and _looks_like_generic_open(stripped_text, i):
                angle_depth = 1
            elif not original_text[i].isspace():
                saw_token = True
        elif ch == "<" and angle_depth > 0:
            angle_depth += 1
        elif ch == ">" and angle_depth > 0:
            angle_depth -= 1
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0 and ch == ")":
                break
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0 and angle_depth == 0:
            count += 1
        elif not original_text[i].isspace():
            saw_token = True
        i += 1
    return count + 1 if saw_token else 0


def _split_top_level(text: str, sep: str = ",") -> List[str]:
    """Split *text* on *sep* at top level only, treating `<...>` as nested -
    same idea as _count_params_arity's depth tracking, but returning the
    pieces themselves (used for an `implements` list, where a generic type
    argument's own comma, e.g. `Comparable<Map<String, Id>>`, must not be
    mistaken for a list separator)."""
    parts: List[str] = []
    depth = 0
    buf: List[str] = []
    for ch in text:
        if ch == "<":
            depth += 1
            buf.append(ch)
        elif ch == ">":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def _simple_type_name(token: str) -> str:
    """Reduce a possibly generic and/or namespaced type token
    (`Database.Batchable<sObject>`, `MyNamespace.BaseClass`) down to the bare
    local identifier the symbol table indexes by: drop any `<...>` generic
    argument list, then take the last `.`-segment (namespace/managed-package
    prefix - these never appear in the local org's symbol table anyway, so
    keeping only the final segment is what gives a same-org base
    class/interface a chance to resolve)."""
    token = token.strip()
    lt = token.find("<")
    if lt != -1:
        token = token[:lt]
    return token.rsplit(".", 1)[-1].strip()


def _first_param_type_name(params_text: str) -> Optional[str]:
    """Simple type name (see _simple_type_name) of a method signature's
    first parameter, or None if it has no parameters. Used by graph_builder
    to check a candidate Batchable/Schedulable/Queueable callback's first
    parameter type (`Database.BatchableContext`/`SchedulableContext`/
    `QueueableContext`), not just its name+arity - matching by arity alone
    let an unrelated same-arity method (e.g. a Queueable class's own,
    genuinely dead `execute(String reason)` - also exactly 1 parameter)
    pass as the real platform callback just for sharing its name and
    parameter *count*."""
    first_param = _split_top_level(params_text.strip())[0].strip()
    if not first_param:
        return None
    tokens = first_param.split()
    if tokens and tokens[0].lower() == "final":  # `final` modifier on a parameter
        tokens = tokens[1:]
    if not tokens:
        return None
    return _simple_type_name(tokens[0])


@dataclass
class TypeHeader:
    kind: str                      # "class" | "interface" | "trigger"
    name: str
    extends: List[str]             # 0+ names: a class has at most one, an interface can have several
    implements: List[str]
    sobject: Optional[str]         # trigger's "on X" target, informational only
    is_test: bool                  # @isTest class - test-only code, not production
    header_line: int
    header_text: str
    header_start: int
    header_end: int                # offset of the '{' that opens the body


def strip_comments_and_strings(text: str) -> str:
    """Blank out // and /* */ comments and '...' string literals, keeping
    every character's position (and all newlines) intact so downstream line
    numbers and offsets still line up with the original text."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                out[j] = " "
                j += 1
            i = j
        elif ch == "/" and i + 1 < n and text[i + 1] == "*":
            # Bug fix: old loop used `j + 1 < n` which stopped one character
            # short when the comment was never closed, leaving a real identifier
            # character un-blanked and causing false-positive edge matches.
            j = i
            out[j] = " "
            if j + 1 < n:
                out[j + 1] = " "
            j += 2
            while j < n:
                if j + 1 < n and text[j] == "*" and text[j + 1] == "/":
                    out[j] = " "
                    out[j + 1] = " "
                    j += 2
                    break
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            i = j
        elif ch == "'":
            j = i
            out[j] = " "
            j += 1
            while j < n and text[j] != "'":
                if text[j] == "\\" and j + 1 < n:
                    if text[j] != "\n":
                        out[j] = " "
                    j += 1
                    if text[j] != "\n":
                        out[j] = " "
                    j += 1
                    continue
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            if j < n:
                out[j] = " "
                j += 1
            i = j
        else:
            i += 1
    return "".join(out)


def _line_offsets(text: str) -> List[int]:
    """Offset (into text) of the start of each line, for bisect-based
    offset -> line-number lookup."""
    offsets = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def _line_number(line_starts: List[int], offset: int) -> int:
    return bisect_right(line_starts, offset)  # 1-based


line_offsets = _line_offsets  # public alias, used by graph_builder to build node names
line_number = _line_number  # public alias, used by graph_builder for a method node's start line


def _extract_method_signature(buffer: str) -> Optional[Tuple[str, int, bool, Optional[str]]]:
    """(method_name, arity, has_return_type, first_param_type) from a
    signature buffer, or None if it doesn't look like a method (a
    control-flow keyword, an inner type's `{`, ...).

    has_return_type distinguishes a constructor (`public Foo(...)` - nothing
    but modifiers/annotations before the name) from a same-named regular
    method (`public static Account Account(...)` is legal Apex - the
    returned Account is a type, not the constructor): the token immediately
    before the matched name is checked against _METHOD_MODIFIER_TOKENS and
    a bare `@...` annotation; anything else still standing there is treated
    as a return type."""
    normalised = " ".join(buffer.split())
    m = _METHOD_SIG_RE.search(normalised)
    if not m:
        return None
    name = m.group(1)
    if name.lower() in _NON_METHOD_WORDS:
        return None
    prefix = normalised[:m.start(1)].strip()
    has_return_type = False
    if prefix:
        last_token = prefix.split()[-1]
        has_return_type = (
            not last_token.startswith("@")
            and last_token.lower() not in _METHOD_MODIFIER_TOKENS
        )
    return name, _count_params_arity(m.group(2)), has_return_type, _first_param_type_name(m.group(2))


@dataclass
class MethodSpan:
    """One method body found by find_method_spans."""
    start: int
    end: int
    name: str
    is_test: bool           # @isTest annotation or legacy testMethod modifier on this method
    arity: int               # parameter count - keeps overloads as separate method nodes
    is_override: bool        # `override` keyword - drives possible_override fan-out
    entry_point_reason: Optional[str]  # annotation/`global`-derived reason, or None
    has_return_type: bool    # False for a constructor-shaped signature (see _extract_method_signature)
    first_param_type: Optional[str]  # simple type name of param 1, or None if no params - see _first_param_type_name
    # Offset of this method's own *name* token in its declaration
    # (`public void checkPermission(...) {` - the offset of `checkPermission`
    # there), not to be confused with `start` (the body's opening `{` + 1).
    # None if it couldn't be pinned down (shouldn't normally happen once a
    # signature already matched). parse_apex_file uses this to keep the
    # same-class bare-call detection (self_method_names) from mistaking a
    # method's own declaration line for a call to itself - `checkPermission`
    # immediately followed by `(` appears at both, and only the offset lets
    # them be told apart.
    name_start: Optional[int]


def _last_name_paren_offset(buffer: str, name: str) -> Optional[int]:
    """Offset within *buffer* of the last `name(` (as a whole identifier,
    optional whitespace before the paren) - the *last* such match, not the
    first, because _METHOD_SIG_RE itself is anchored at the end of the
    (whitespace-normalised) buffer: the real signature is always the final
    `name(...)` immediately before the `{`, and an earlier match would only
    be an unrelated same-named mention earlier in the buffer (e.g. inside a
    preceding annotation's arguments)."""
    pattern = re.compile(r"\b" + re.escape(name) + r"\s*\(")
    offset = None
    for m in pattern.finditer(buffer):
        offset = m.start()
    return offset


def find_method_spans(stripped: str) -> List[MethodSpan]:
    """One pass over the (comment/string-stripped) text tracking brace depth.
    Returns a MethodSpan for every brace block opened directly inside the
    top-level type body (depth 1 -> 2) whose preceding text looks like a
    method signature.

    is_test reflects only that method's own signature buffer (an @isTest
    annotation or testMethod modifier immediately preceding it) - a
    class-wide @isTest annotation is handled separately via
    TypeHeader.is_test. arity is the parameter count, used to keep
    overloads (`foo(Id)` vs `foo(Id, Boolean)`) as separate method nodes
    instead of collapsing them - same-arity overloads still collide (no
    parameter *type* resolution here). is_override reflects the `override`
    keyword, used by graph_builder to fan a call out to every known
    subclass's override of the same method (best-effort polymorphic
    dispatch - see module docstring). entry_point_reason/has_return_type
    feed graph_builder's dead-code entry-point classification (constructor
    detection there also needs the enclosing class's display name, which
    this function doesn't have)."""
    depth = 0
    # A stack entry is the in-progress MethodSpan for a signature-preceded
    # '{' (end filled in once its matching '}' is found below), or None for
    # any other brace (a nested block, an if/for body, ...) opened along the
    # way - popped and discarded the same as a real span, just never
    # appended to spans.
    stack: List[Optional[MethodSpan]] = []
    last_boundary = 0
    spans: List[MethodSpan] = []

    for i, ch in enumerate(stripped):
        if ch == "{":
            buffer = stripped[last_boundary:i]
            sig = _extract_method_signature(buffer) if depth == 1 else None
            span = None
            if sig:
                name, arity, has_return_type, first_param_type = sig
                is_test = bool(_TEST_METHOD_RE.search(buffer))
                is_override = bool(_OVERRIDE_RE.search(buffer))
                entry_point_reason = None
                for pattern, reason in _ENTRY_POINT_CHECKS:
                    if pattern.search(buffer):
                        entry_point_reason = reason
                        break
                name_start = None
                rel_offset = _last_name_paren_offset(buffer, name)
                if rel_offset is not None:
                    name_start = last_boundary + rel_offset
                span = MethodSpan(
                    start=i + 1, end=-1, name=name, is_test=is_test,
                    arity=arity, is_override=is_override,
                    entry_point_reason=entry_point_reason,
                    has_return_type=has_return_type,
                    first_param_type=first_param_type,
                    name_start=name_start,
                )
            stack.append(span)
            depth += 1
            last_boundary = i + 1
        elif ch == "}":
            # Bug fix: the old `max(0, depth - 1)` guard let depth stay at 0
            # while still popping a stack frame for a stray `}`, corrupting
            # every subsequent method-span attribution below that point.
            if depth > 0:
                depth -= 1
                if stack:
                    span = stack.pop()
                    if span is not None:
                        span.end = i
                        spans.append(span)
            last_boundary = i + 1
        elif ch == ";":
            last_boundary = i + 1

    return spans


def _span_index_at(spans: List[MethodSpan], offset: int) -> int:
    """Index into *spans* of the method span containing *offset*, or -1 if
    *offset* falls outside every method (e.g. a class-level field
    declaration). Uses binary search (O(log n)) instead of a linear scan:
    spans are non-overlapping and sorted by start_off, so bisect_right gives
    the candidate index in one step."""
    if not spans:
        return -1
    starts = [s.start for s in spans]
    idx = bisect_right(starts, offset) - 1
    if idx >= 0:
        span = spans[idx]
        if span.start <= offset < span.end:
            return idx
    return -1


def find_type_header(stripped: str, line_starts: List[int]) -> Optional[TypeHeader]:
    match = _TYPE_HEADER_RE.search(stripped)
    if not match:
        return None

    kind = match.group(1).lower()
    name = match.group(2)
    between = match.group(3)
    # Only one top-level type is declared per file, so any @isTest annotation
    # in the prologue before it (modifiers/annotations on their own lines,
    # nothing else precedes the outer declaration) belongs to this type.
    is_test = bool(_ISTEST_RE.search(stripped[:match.start()]))

    extends: List[str] = []
    implements: List[str] = []
    sobject = None

    if kind == "trigger":
        on_match = _TRIGGER_ON_RE.search(between)
        if on_match:
            sobject = on_match.group(1)
    else:
        ext_match = _EXTENDS_RE.search(between)
        if ext_match:
            extends = [
                name for name in (
                    _simple_type_name(tok) for tok in _split_top_level(ext_match.group(1))
                ) if name
            ]
        impl_match = _IMPLEMENTS_RE.search(between)
        if impl_match:
            implements = [
                name for name in (
                    _simple_type_name(tok) for tok in _split_top_level(impl_match.group(1))
                ) if name
            ]

    return TypeHeader(
        kind=kind,
        name=name,
        extends=extends,
        implements=implements,
        sobject=sobject,
        is_test=is_test,
        header_line=_line_number(line_starts, match.start()),
        header_text=between,
        header_start=match.start(),
        header_end=match.end(),
    )


def _find_matching_close(text: str, open_pos: int, opens: str, closes: str) -> Optional[int]:
    """Offset of the closing bracket matching the opening one at *open_pos*,
    treating every char in *opens*/*closes* as one shared depth counter.
    None if unterminated (malformed/truncated file - callers fall back to
    end-of-text rather than crash). Shared by _find_matching_close_brace
    (opens="{", closes="}") and _find_matching_close_paren (opens="([{",
    closes=")]}") - they differ only in which characters count toward
    depth."""
    depth = 0
    for i in range(open_pos, len(text)):
        ch = text[i]
        if ch in opens:
            depth += 1
        elif ch in closes:
            depth -= 1
            if depth == 0:
                return i
    return None


def _find_matching_close_brace(text: str, open_brace_pos: int) -> Optional[int]:
    """Offset of the '}' matching the '{' at *open_brace_pos*, tracking only
    brace nesting - a type or method body's extent is delimited purely by
    braces; parens/brackets inside don't need separate tracking for this
    purpose, and a collection-literal's own `{...}` (`new Set<String>{'a'}`)
    is itself a self-balancing pair that doesn't upset a brace-only count."""
    return _find_matching_close(text, open_brace_pos, "{", "}")


def _blank_ranges(text: str, ranges: List[Tuple[int, int]]) -> str:
    """Blank out each [start, end) range in *text* (space-fill, newlines
    kept intact) - same technique strip_comments_and_strings already uses,
    applied here to a *nested type's* body ranges instead of comments/
    strings. Used to keep an enclosing type's own reference-scan from also
    picking up (and misattributing to itself) references that actually live
    inside a nested type's body - that nested type gets its own separate,
    correctly-scoped scan instead (see graph_builder)."""
    if not ranges:
        return text
    out = list(text)
    for start, end in ranges:
        for i in range(max(0, start), min(len(text), end)):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)


blank_ranges = _blank_ranges  # public alias, used by graph_builder to scope each type's own scan


@dataclass
class NestedTypeSpan:
    """One class/interface/enum declared directly inside another type's own
    body (not further nested, and not inside a method body) - found by
    find_nested_type_headers. No `sobject` field the way TypeHeader has one:
    Apex doesn't allow a nested trigger, so a nested type is always a
    class/interface/enum."""
    kind: str
    name: str
    extends: List[str]
    implements: List[str]
    is_test: bool          # this type's own @isTest only - the caller ORs in every ancestor's
    header_line: int
    header_start: int      # offset of the "class"/"interface"/"enum" keyword itself
    body_start: int        # offset of this type's own '{' + 1
    body_end: int           # offset of this type's own matching '}'


def find_nested_type_headers(text: str, line_starts: List[int]) -> List[NestedTypeSpan]:
    """One brace-depth pass over *text* - the ENCLOSING type's own body,
    INCLUDING its own leading '{' at index 0 (same calling convention
    find_method_spans uses for a whole file: the first character being the
    enclosing type's own opening brace takes depth 0->1 before anything else
    is checked, so a type declared directly inside is found at depth==1,
    mirroring find_method_spans exactly - and for the identical reason, a
    method's own '{' - also at depth==1 - never accidentally matches here,
    since its signature buffer never contains the literal word
    class/interface/enum).

    Returns every class/interface/enum declared directly inside *text* - not
    further nested inside one of those, and not inside a method body.
    Doesn't recurse itself; callers (see apex_parser.discover_all_types)
    recurse by calling this again on each result's own
    text[body_start-1:body_end+1] slice, the same pattern already used for
    finding a class's own methods via find_method_spans."""
    depth = 0
    stack: List[Tuple[int, Optional[Tuple[str, str, List[str], List[str], bool, int, int]]]] = []
    last_boundary = 0
    results: List[NestedTypeSpan] = []

    for i, ch in enumerate(text):
        if ch == "{":
            info = None
            if depth == 1:
                buffer_with_brace = text[last_boundary:i + 1]
                match = _TYPE_HEADER_RE.search(buffer_with_brace)
                if match:
                    kind = match.group(1).lower()
                    if kind != "trigger":  # Apex disallows a nested trigger
                        name = match.group(2)
                        between = match.group(3)
                        is_test = bool(_ISTEST_RE.search(buffer_with_brace[:match.start()]))
                        ext_match = _EXTENDS_RE.search(between)
                        extends = [
                            n for n in (
                                _simple_type_name(t) for t in _split_top_level(ext_match.group(1))
                            ) if n
                        ] if ext_match else []
                        impl_match = _IMPLEMENTS_RE.search(between)
                        implements = [
                            n for n in (
                                _simple_type_name(t) for t in _split_top_level(impl_match.group(1))
                            ) if n
                        ] if impl_match else []
                        header_start = last_boundary + match.start()
                        header_line = _line_number(line_starts, header_start)
                        info = (kind, name, extends, implements, is_test, header_start, header_line)
            stack.append((i + 1, info))
            depth += 1
            last_boundary = i + 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if stack:
                    body_start, info = stack.pop()
                    if info:
                        kind, name, extends, implements, is_test, header_start, header_line = info
                        results.append(NestedTypeSpan(
                            kind=kind, name=name, extends=extends, implements=implements,
                            is_test=is_test, header_line=header_line, header_start=header_start,
                            body_start=body_start, body_end=i,
                        ))
            last_boundary = i + 1
        elif ch == ";":
            last_boundary = i + 1

    return results


@dataclass
class DiscoveredType:
    """One type in a file - either the file's own top-level type, or any
    class/interface/enum nested inside it at any depth (Apex allows a class
    nested inside a class nested inside a class, however rarely used in
    practice) - flattened into one uniform shape graph_builder can iterate
    over without caring which case it is. Always ordered so a parent appears
    before its own nested children (build discover_all_types)."""
    kind: str
    name: str                              # simple/bare name, e.g. "Wrapper" - what a constructor must match
    extends: List[str]
    implements: List[str]
    sobject: Optional[str]                 # only ever set for the top-level type
    is_test: bool                          # this type's own @isTest, OR'd in with every ancestor's
    header_line: int
    header_start: int                      # offset of the "class"/"interface"/"trigger" keyword
    header_end: int                        # offset of the '{' that opens the body
    body_end: int                          # offset of the matching '}'
    qualified_name: str                    # "Outer" or "Outer.Inner" or "Outer.Inner.Deeper"
    parent_qualified_name: Optional[str]   # immediate enclosing type's qualified_name, or None for the top-level type


def discover_all_types(stripped: str, line_starts: List[int]) -> List[DiscoveredType]:
    """The file's top-level type, plus every class/interface/enum nested
    inside it at any depth, flattened into one list (parents before their
    own children). Each type's own direct methods still need a separate
    find_method_spans call scoped to its own [header_end, body_end+1) span -
    this function only discovers *type* boundaries, not methods (see
    graph_builder, which does both per type)."""
    header = find_type_header(stripped, line_starts)
    if header is None:
        return []

    # header.header_end is one past the '{' (TypeHeader's established
    # convention - see find_type_header) - _find_matching_close_brace and
    # find_nested_type_headers both need the brace's own position instead,
    # hence the "- 1" everywhere below that wants the literal '{'.
    outer_brace_pos = header.header_end - 1
    outer_close = _find_matching_close_brace(stripped, outer_brace_pos)
    if outer_close is None:
        outer_close = len(stripped) - 1  # malformed/truncated - best effort, don't crash

    results: List[DiscoveredType] = [DiscoveredType(
        kind=header.kind, name=header.name, extends=header.extends,
        implements=header.implements, sobject=header.sobject, is_test=header.is_test,
        header_line=header.header_line, header_start=header.header_start,
        header_end=header.header_end, body_end=outer_close,
        qualified_name=header.name, parent_qualified_name=None,
    )]

    def _recurse(brace_pos: int, close_pos: int, parent_qualified: str, parent_is_test: bool) -> None:
        # text[0] is the '{' at brace_pos - the calling convention
        # find_nested_type_headers expects (mirroring find_method_spans).
        text = stripped[brace_pos:close_pos + 1]
        for nested in find_nested_type_headers(text, line_starts):
            abs_header_start = brace_pos + nested.header_start
            # nested.body_start is "one past the nested type's own '{'",
            # relative to *text* - subtract 1 for the brace's own absolute
            # position (what the recursive call and _find_matching_close_brace
            # both need); the +0 (no -1) form is what DiscoveredType.header_end
            # stores, matching TypeHeader's own "one past the brace" convention.
            abs_open_brace = brace_pos + nested.body_start - 1
            abs_body_end = brace_pos + nested.body_end
            effective_is_test = nested.is_test or parent_is_test
            qualified = f"{parent_qualified}.{nested.name}"
            results.append(DiscoveredType(
                kind=nested.kind, name=nested.name, extends=nested.extends,
                implements=nested.implements, sobject=None, is_test=effective_is_test,
                header_line=nested.header_line, header_start=abs_header_start,
                header_end=abs_open_brace + 1, body_end=abs_body_end,
                qualified_name=qualified, parent_qualified_name=parent_qualified,
            ))
            _recurse(abs_open_brace, abs_body_end, qualified, effective_is_test)

    _recurse(outer_brace_pos, outer_close, header.name, header.is_test)
    return results


def _immediately_preceded_by_dot(text: str, start: int) -> bool:
    """True if the nearest non-whitespace character before *start* is '.' -
    i.e. this identifier is somebody's member (`x.member`), not a bare
    token. Bug fix: _preceding_word (below) also returns "" for this case
    (it stops walking backward the instant it hits the dot, same as it does
    for a preceding '(' or ';'), so the bare same-class call heuristic in
    parse_apex_file couldn't tell "genuinely bare identifier" apart from
    "the right-hand side of somebody else's member access" - `helper.
    process()` was misread as a same-class call to `process()` whenever the
    *calling* class happened to also declare its own same-named method
    (also swallowed every `super.method()` call this same way, since `this`
    is the only qualifier special-cased elsewhere in this file). This is
    checked separately from _preceding_word specifically for that reason."""
    i = start - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    return i >= 0 and text[i] == "."


def _preceding_word(text: str, start: int) -> Optional[str]:
    i = start - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    end = i + 1
    while i >= 0 and (text[i].isalnum() or text[i] == "_"):
        i -= 1
    if end - (i + 1) <= 0:
        return None
    return text[i + 1:end]


def _next_non_space(text: str, start: int) -> Tuple[Optional[str], int]:
    i = start
    n = len(text)
    while i < n and text[i].isspace():
        i += 1
    if i >= n:
        return None, i
    return text[i], i


def _read_ident_at(text: str, start: int) -> Tuple[Optional[str], int]:
    m = _IDENT_RE.match(text, start)
    if not m:
        return None, start
    return m.group(0), m.end()


def _find_matching_close_paren(text: str, open_paren_pos: int) -> Optional[int]:
    """Offset of the ')' matching the '(' at *open_paren_pos*, tracking
    `()[]{}` nesting (so a `new X(a, new Set<Id>{b, c})`-style argument list
    doesn't close the match early) - same nesting idea as _count_call_args,
    but returning the matching position instead of an argument count."""
    return _find_matching_close(text, open_paren_pos, "([{", ")]}")


def _emit_member_or_call(
    emit, stripped: str, original_text: str, target_id: str, line_no: int, call_kind: str,
    caller_method: Optional[str], method_is_test: bool, caller_arity: Optional[int],
    member: Optional[str], after_member_char: Optional[str], after_member_pos: int,
    *, exact_type: bool = False,
) -> None:
    """Shared classify-and-emit step for a `<target_id>.<member>` access -
    used both for the common case (a type/variable token immediately
    followed by '.') and for a member accessed off a freshly-constructed
    `new X().member` chain. A trailing '(' makes it a call (*call_kind*:
    instance_call/static_call, with its own argument count via
    _count_call_args); otherwise it's a field_access. No-op if *member*
    wasn't actually an identifier (nothing to attribute). exact_type is
    forwarded to Occurrence - see its docstring in models.py."""
    if not member:
        return
    if after_member_char == "(":
        call_arity = _count_call_args(stripped, original_text, after_member_pos)
        emit(target_id, line_no, call_kind, caller_method, member, method_is_test, member,
             caller_arity=caller_arity, callee_arity=call_arity, exact_type=exact_type)
    else:
        emit(target_id, line_no, "field_access", caller_method, member, method_is_test,
             caller_arity=caller_arity)


def parse_apex_file(
    original_text: str,
    rel_path: str,
    self_id: str,
    symbol_table: Dict[str, str],
    *,
    pre_stripped: Optional[str] = None,
    enclosing_method_owner: Optional[Dict[str, str]] = None,
) -> Tuple[Optional[TypeHeader], List[Tuple[str, Occurrence]]]:
    """
    Parse one Apex file's text.

    symbol_table maps lowercased class/interface/trigger name -> node id for
    every Apex type known in the org (excluding this file's own type).

    pre_stripped: pass the already-computed strip_comments_and_strings() result
    to avoid doing the work twice (graph_builder computes it in Pass 1).

    enclosing_method_owner: when this type is a *nested* type (a class
    declared inside another), {method_name_lower: owning_ancestor_node_id}
    for every method declared on an enclosing type (closest ancestor wins on
    a name collision) - graph_builder builds this from the already-completed
    Pass 1 method tables and passes it in when scanning a nested type. Apex
    lets a nested class call its enclosing type's methods unqualified
    (`helper()` instead of `Outer.helper()`), the same implicit-receiver
    style as a same-class bare call - without this, such a call fell through
    every branch below with no match (not a type, not a local, not this
    type's own method) and was silently dropped: not a class-level edge, not
    a method-level one, nothing. See the bare-call block below.

    Returns (type_header, [(target_node_id, Occurrence), ...]).
    """
    stripped = pre_stripped if pre_stripped is not None else strip_comments_and_strings(original_text)
    line_starts = _line_offsets(original_text)
    original_lines = original_text.splitlines()
    method_spans = find_method_spans(stripped)
    header = find_type_header(stripped, line_starts)
    scoped_local_types = _build_local_type_map(stripped, symbol_table, method_spans)
    # Every method name declared directly in *this* class/interface/trigger -
    # used below to resolve a same-class call written without a receiver
    # (`checkPermission(x)`) or with an explicit `this.` (`this.checkPermission(x)`).
    # Apex has no free-standing functions, so a bare `identifier(...)` call is
    # always either of those two forms - never a built-in/global call - which
    # is what makes matching against this set safe rather than guesswork.
    # Deliberately scoped to methods declared *directly* on this type, not
    # ones only inherited from a superclass without being redeclared here -
    # resolving an inherited-and-uncalled-locally method would need the same
    # base-class lookup machinery graph_builder's polymorphism handling uses,
    # which this per-file parse has no visibility into.
    self_method_names = {s.name.lower() for s in method_spans}
    # A method's own declaration line (`checkPermission(...) {`) matches
    # self_method_names and is immediately followed by `(`, exactly like a
    # real call to it - without excluding these exact offsets, every method
    # would incorrectly read as calling itself once (at its own signature).
    self_declaration_offsets = {s.name_start for s in method_spans if s.name_start is not None}

    results: List[Tuple[str, Occurrence]] = []

    def snippet_for(line_no: int) -> str:
        if 1 <= line_no <= len(original_lines):
            text = original_lines[line_no - 1].strip()
        else:
            text = ""
        return text[:200]

    class_is_test = bool(header and header.is_test)

    def emit(target_id: str, line_no: int, kind: str, caller_method: Optional[str],
              detail: Optional[str], is_test: bool = False, callee_method: Optional[str] = None,
              *, caller_arity: Optional[int] = None, callee_arity: Optional[int] = None,
              exact_type: bool = False) -> None:
        # A self_id-targeted occurrence is NOT dropped here anymore (it used
        # to be, unconditionally) - graph_builder's Pass 2 is what suppresses
        # the noisy class-level self-loop this would otherwise create
        # (a class always textually references its own name - self
        # `new X()`, `X.staticMethod()`, a same-class call resolved below,
        # ...), while still deriving a real *method*-level edge from it when
        # callee_method is set (methodA calling methodB in the same class is
        # genuinely useful information, not noise - that's exactly the
        # "invisible same-class call" gap this change fixes; see
        # self_method_names below). Occurrence kinds that never carry a
        # callee_method (type_reference, instantiation, field_access,
        # instanceof) still end up as complete no-ops downstream, same as
        # today - graph_builder only builds a method-level edge when
        # callee_method is present.
        results.append((
            target_id,
            Occurrence(
                file=rel_path,
                line=line_no,
                snippet=snippet_for(line_no),
                kind=kind,
                caller_method=caller_method,
                detail=detail,
                is_test=class_is_test or is_test,
                callee_method=callee_method,
                caller_arity=caller_arity,
                callee_arity=callee_arity,
                exact_type=exact_type,
            ),
        ))

    header_start, header_end = (header.header_start, header.header_end) if header else (-1, -1)

    if header:
        for ext_name in header.extends:
            target = symbol_table.get(ext_name.lower())
            if target:
                emit(target, header.header_line, "extends", None, None)
        for impl_name in header.implements:
            target = symbol_table.get(impl_name.lower())
            if target:
                emit(target, header.header_line, "implements", None, None)

    # Type.forName('LiteralClassName') - matched against original_text (not
    # stripped) since the class-name string literal is exactly what
    # strip_comments_and_strings blanks out. Offsets are still valid against
    # method_spans/line_starts: original_text and stripped share identical
    # length/positions by construction. See _TYPE_FORNAME_RE for what this
    # does and doesn't resolve.
    for m in _TYPE_FORNAME_RE.finditer(original_text):
        target_id = symbol_table.get(_simple_type_name(m.group(1)).lower())
        if not target_id:
            continue
        start = m.start()
        line_no = _line_number(line_starts, start)
        scope_key = _span_index_at(method_spans, start)
        if scope_key == -1:
            caller_method, method_is_test, caller_arity = None, False, None
        else:
            _span = method_spans[scope_key]
            caller_method, method_is_test, caller_arity = _span.name, _span.is_test, _span.arity
        # Type.newInstance() always invokes the type's no-argument
        # constructor (Apex reflection has no way to pass constructor
        # arguments through it) - callee_arity=0 lets this resolve to that
        # specific constructor's method node the same way an ordinary
        # `new X()` call does, instead of only ever proving the *class* gets
        # instantiated (see module docstring) while its constructor itself
        # still reads as dead.
        target_simple_name = _simple_type_name(m.group(1))
        emit(target_id, line_no, "dynamic_instantiation", caller_method, None, method_is_test,
             target_simple_name, caller_arity=caller_arity, callee_arity=0)

    for m in _IDENT_RE.finditer(stripped):
        start, end = m.start(), m.end()
        if header_start <= start < header_end:
            continue  # already handled via the type header (incl. self name)

        word = m.group(0)
        word_lower = word.lower()
        line_no = _line_number(line_starts, start)
        scope_key = _span_index_at(method_spans, start)
        if scope_key == -1:
            caller_method, method_is_test, caller_arity = None, False, None
        else:
            _span = method_spans[scope_key]
            caller_method, method_is_test, caller_arity = _span.name, _span.is_test, _span.arity
        preceding = _preceding_word(stripped, start)
        next_char, next_pos = _next_non_space(stripped, end)

        target_id = symbol_table.get(word_lower)
        # A local variable/field/param can be named the same as an org type
        # (`Order order = new Order(); order.calculate();` - Apex/Java
        # convention, not an edge case) - word_lower then matches
        # symbol_table too, even though the token is standing in for the
        # *variable*, not the type. var_target (its real declared type, via
        # _build_local_type_map, scoped to *this* identifier's own enclosing
        # method - see that function's docstring for why scoping matters) is
        # what member access through it should resolve to; without
        # preferring it over target_id here, every call through such a
        # variable was misread as a static call on the type whose name it
        # happens to share.
        var_target = _lookup_local_type(scoped_local_types, scope_key, word_lower)

        if preceding and preceding.lower() == "new":
            if next_char == ".":
                # `new Outer.Inner(...)` - a qualified nested-type
                # instantiation. Outer (target_id here) is NOT what's being
                # constructed - Inner is - so falling through to the
                # ordinary handling below would wrongly emit an
                # instantiation edge onto Outer itself. Inner is read off
                # the qualifier and resolved on its own; the (rare) chained-
                # call-directly-off-a-qualified-`new` form
                # (`new Outer.Inner().method()`) isn't specially handled the
                # way the unqualified case below is - a documented, narrow
                # gap rather than worth duplicating that whole block for.
                member, member_end = _read_ident_at(stripped, next_pos + 1)
                if member:
                    # Qualified form ("outer.inner") tried first - the
                    # precise match, registered for every nested type
                    # regardless of any bare-name collision elsewhere in the
                    # org; bare form is a defensive fallback, not expected
                    # to be needed given that registration.
                    member_target = symbol_table.get(f"{word_lower}.{member.lower()}") or symbol_table.get(member.lower())
                    if member_target:
                        after_ctor_char, after_ctor_pos = _next_non_space(stripped, member_end)
                        ctor_arity = (
                            _count_call_args(stripped, original_text, after_ctor_pos)
                            if after_ctor_char == "(" else None
                        )
                        emit(member_target, line_no, "instantiation", caller_method,
                             None, method_is_test, member if ctor_arity is not None else None,
                             caller_arity=caller_arity, callee_arity=ctor_arity)
                continue
            if target_id:
                # callee_method/callee_arity here is what lets this
                # instantiation resolve to a real method-level edge onto the
                # matching constructor overload (see _resolve_method_id in
                # graph_builder) - `new X(...)` used to only ever produce a
                # class-level edge, which meant every constructor looked
                # dead by construction and had to be unconditionally
                # excluded from dead-code candidacy; see README.
                ctor_arity = _count_call_args(stripped, original_text, next_pos) if next_char == "(" else None
                emit(target_id, line_no, "instantiation", caller_method,
                     None, method_is_test, word if ctor_arity is not None else None,
                     caller_arity=caller_arity, callee_arity=ctor_arity)
                # Fluent/chained call directly off the constructor
                # (`new Utility().formatDate(x)`, `new PagedResult().build()`)
                # - without this, only the instantiation itself was recorded
                # and the chained call (plus its method-level edge) was
                # silently dropped. Only the *first* chained call is
                # attributed to target_id - a second hop (`.foo().bar()`)
                # would be a call on foo()'s return value, whose type this
                # parser doesn't infer, so going further would be guessing.
                if next_char == "(":
                    close_paren = _find_matching_close_paren(stripped, next_pos)
                    if close_paren is not None:
                        after_ctor_char, after_ctor_pos = _next_non_space(stripped, close_paren + 1)
                        if after_ctor_char == ".":
                            member, member_end = _read_ident_at(stripped, after_ctor_pos + 1)
                            after_member_char, after_member_pos = (
                                _next_non_space(stripped, member_end) if member else (None, member_end)
                            )
                            # exact_type=True: the receiver here is a call
                            # chained directly off `new X(...)`, so its
                            # concrete type is exactly X - not merely
                            # declared-as-X the way a variable/field/param
                            # would be. graph_builder's polymorphic-dispatch
                            # fan-out must not treat this as ambiguous (see
                            # Occurrence.exact_type in models.py).
                            _emit_member_or_call(
                                emit, stripped, original_text, target_id, line_no, "instance_call",
                                caller_method, method_is_test, caller_arity,
                                member, after_member_char, after_member_pos,
                                exact_type=True,
                            )
            continue
        if preceding and preceding.lower() == "instanceof":
            if target_id:
                emit(target_id, line_no, "instanceof", caller_method, None, method_is_test,
                     caller_arity=caller_arity)
            continue

        if next_char == ".":
            member, member_end = _read_ident_at(stripped, next_pos + 1)
            after_member_char, after_member_pos = _next_non_space(stripped, member_end) if member else (None, member_end)
            # `this.member(...)` - an explicit same-class call/field access.
            # Resolved directly against self_method_names rather than
            # falling through to the var_target/target_id checks below:
            # "this" is never a declared local/field (var_target) nor an org
            # type (target_id), so without this branch it always fell
            # through to the bare-mention fallback at the bottom, which also
            # requires target_id and so never fired either - "this.foo()"
            # was previously invisible to the parser, same bug bare
            # same-class calls have (see the bare-call branch further down).
            if word_lower == "this" and member and member.lower() in self_method_names:
                _emit_member_or_call(
                    emit, stripped, original_text, self_id, line_no, "self_call",
                    caller_method, method_is_test, caller_arity, member, after_member_char, after_member_pos,
                )
                continue
            # `super.member(...)` - an explicit call/field access on the
            # immediate base class, resolved against this type's own
            # `extends` (single-entry for a class) rather than
            # self_method_names: without this, "super" matched nothing below
            # (not a type, not a declared local, not one of this type's own
            # methods) and the call vanished with no occurrence at any
            # level - the base method could show 0 in-degree and read as
            # dead code even when a subclass's override calls it via
            # `super.x()` on every invocation. exact_type=True: `super.x()`
            # is a direct, non-virtual call to the named base class's own
            # implementation (not dispatched through the receiver's runtime
            # type the way a plain `instance_call` is), so it must not
            # trigger graph_builder's possible_override polymorphic fan-out.
            # Best-effort/single-hop like the rest of this parser: resolves
            # only to the immediate `extends` target, not further up a
            # multi-level hierarchy, and only when that name is itself a
            # known org type.
            if word_lower == "super" and member and header is not None:
                base_id = None
                for ext_name in header.extends:
                    base_id = symbol_table.get(ext_name.lower())
                    if base_id:
                        break
                if base_id:
                    _emit_member_or_call(
                        emit, stripped, original_text, base_id, line_no, "instance_call",
                        caller_method, method_is_test, caller_arity, member, after_member_char, after_member_pos,
                        exact_type=True,
                    )
                    continue
            # `Outer.Inner` as a qualified TYPE reference - not a call, not
            # preceded by `new` (handled separately above) - e.g. spelled
            # out in full as a return type, variable declaration, or
            # parameter type (`public Outer.Inner build() { ... }`).
            # Checked before the var_target/target_id member-access handling
            # below: without this, `Outer.Inner` used this way was misread
            # as accessing a *field* literally named "Inner" on Outer,
            # emitting a wrong field_access edge onto Outer instead of a
            # type_reference onto Inner.
            if member:
                qualified_target = symbol_table.get(f"{word_lower}.{member.lower()}")
                if qualified_target:
                    emit(qualified_target, line_no, "type_reference", caller_method, None, method_is_test,
                         caller_arity=caller_arity)
                    continue
            # var_target == self_id (a local/field declared as *this* class's
            # own type, e.g. `MyClass other = ...; other.virtualMethod();`)
            # used to be explicitly excluded here (`and var_target !=
            # self_id`) - since emit() used to unconditionally drop any
            # self_id-targeted occurrence anyway, that exclusion was a no-op
            # short-circuit, not a deliberate design choice. Now that emit()
            # no longer drops these (see its docstring), removing the
            # exclusion lets a same-class-typed variable's calls resolve
            # too - kept as kind="instance_call" (not "self_call"), since
            # the variable's *runtime* type could still be an actual
            # subclass of this class, same polymorphic-dispatch ambiguity
            # a call through any other declared type carries.
            if var_target:
                _emit_member_or_call(
                    emit, stripped, original_text, var_target, line_no, "instance_call",
                    caller_method, method_is_test, caller_arity, member, after_member_char, after_member_pos,
                )
                continue
            if target_id:
                if member:
                    _emit_member_or_call(
                        emit, stripped, original_text, target_id, line_no, "static_call",
                        caller_method, method_is_test, caller_arity, member, after_member_char, after_member_pos,
                    )
                else:
                    emit(target_id, line_no, "type_reference", caller_method, None, method_is_test,
                         caller_arity=caller_arity)
            continue

        # Bare same-class call (`checkPermission(userId)`, no receiver,
        # implicit `this`) - Apex has no free-standing functions, so a bare
        # identifier immediately followed by `(` is always either this or a
        # `this.`-qualified call (handled above); matching against
        # self_method_names (this class's own declared method names) is what
        # makes resolving it safe rather than guesswork. `not (target_id or
        # var_target)` keeps the existing precedence - an org type / local
        # variable of the same spelling wins, consistent with every other
        # check in this loop. This is the bug fix this whole block exists
        # for: without it, a private helper called without `this.` (the
        # overwhelmingly common Apex style) was invisible to this parser -
        # no occurrence emitted at all, at any level - which made it read as
        # dead code no matter how many sibling methods actually called it.
        if (
            next_char == "(" and not (target_id or var_target)
            and start not in self_declaration_offsets
            and not _immediately_preceded_by_dot(stripped, start)
        ):
            if word_lower in self_method_names:
                callee_arity = _count_call_args(stripped, original_text, next_pos)
                emit(self_id, line_no, "self_call", caller_method, word, method_is_test, word,
                     caller_arity=caller_arity, callee_arity=callee_arity)
                continue
            # Same idea, one lexical scope out: a nested type calling its
            # enclosing type's method with no qualifier at all (see
            # enclosing_method_owner's docstring above). Emitted as
            # static_call (not self_call - self_call's own "calls (same
            # class)" UI label would be wrong once source and target are two
            # different nodes) targeting the owning ancestor directly; the
            # existing resolve-by-arity machinery downstream (graph_builder's
            # _resolve_method_id) still disambiguates overloads from here.
            if enclosing_method_owner and word_lower in enclosing_method_owner:
                callee_arity = _count_call_args(stripped, original_text, next_pos)
                emit(enclosing_method_owner[word_lower], line_no, "static_call", caller_method, word,
                     method_is_test, word, caller_arity=caller_arity, callee_arity=callee_arity)
                continue

        # Bare mention, no member access: only a type reference if this text
        # isn't *also* a known local variable/field/param name anywhere in
        # the file - otherwise both halves of `Order order = ...` (the type
        # *and* the variable name) match symbol_table and double-count as a
        # reference, and a plain variable read (`return order;`,
        # `if (order != null)`) gets miscounted as one too. This can drop a
        # type_reference that had no other occurrence in the file (e.g. an
        # unused parameter of a colliding name), but that's already the
        # lowest-signal edge kind (hidden by default in the UI) and the
        # far more common case - a `new X()` or member-access occurrence
        # elsewhere - still resolves the edge correctly.
        if target_id and not var_target:
            emit(target_id, line_no, "type_reference", caller_method, None, method_is_test,
                 caller_arity=caller_arity)

    return header, results

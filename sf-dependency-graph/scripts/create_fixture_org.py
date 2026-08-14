"""
Create a demo org folder for sf-dependency-graph.

This is a *separate* fixture from samples/org1 & org2 (which apex-org-diff
and lwc-org-diff's own tests depend on for exact diff-stat assertions) -
this tool needs real cross-references between classes/triggers/LWC to have
anything to draw, which the shared samples fixture doesn't have. Generates
sf-dependency-graph/fixture_org/{classes,lwc}, deliberately exercising every
edge kind the parsers detect:

  extends · implements · instanceof · instantiation · static_call ·
  field_access · type_reference · apex_wire · apex_imperative ·
  apex_unused_import · composition (LWC-to-LWC) · dynamic_instantiation

plus one isolated class (EmailService) with no connections at all, so the
graph shows both a hub and a leaf; a dedicated dead-code-detection block
(DeadCodeSample/DeadCodeSampleCaller/ReflectionFactory/
ReflectivelyInstantiated) covering every entry-point exclusion and both
dead/test_only buckets; and a broader "dead-code gallery" (see that section
below) surveying every format/pattern of dead code we could think of -
whole dead classes, dead methods beside live ones, comment/string-literal
safety, a dead overload among live ones, an orphaned LWC bundle, and two
deliberate, documented false negatives (polymorphic fan-out masking a dead
override; a call inside a permanently-false branch) this tool doesn't - and
by design can't cheaply - catch.
"""
import pathlib

base = pathlib.Path(__file__).parent.parent / "fixture_org"
classes = base / "classes"
triggers = classes / "triggers"
lwc = base / "lwc"
classes.mkdir(parents=True, exist_ok=True)
triggers.mkdir(parents=True, exist_ok=True)
lwc.mkdir(parents=True, exist_ok=True)


def write_cls(name: str, body: str) -> None:
    (classes / f"{name}.cls").write_text(body, encoding="utf-8")


def bundle(name: str, *, js: str, html: str, css: str = None) -> None:
    d = lwc / name
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.js").write_text(js, encoding="utf-8")
    (d / f"{name}.html").write_text(html, encoding="utf-8")
    if css is not None:
        (d / f"{name}.css").write_text(css, encoding="utf-8")
    (d / f"{name}.js-meta.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
        "    <apiVersion>59.0</apiVersion>\n"
        "    <isExposed>true</isExposed>\n"
        "    <targets>\n"
        "        <target>lightning__RecordPage</target>\n"
        "    </targets>\n"
        "</LightningComponentBundle>\n",
        encoding="utf-8",
    )


# --- classes -----------------------------------------------------------

write_cls("Loggable", (
    "public interface Loggable {\n"
    "    void log(String message);\n"
    "}\n"
))

write_cls("BaseController", (
    "public virtual class BaseController {\n"
    "    protected static final String DEFAULT_FORMAT = 'yyyy-MM-dd';\n\n"
    "    public virtual void log(String message) {\n"
    "        System.debug(message);\n"
    "    }\n"
    "}\n"
))

write_cls("Utility", (
    "public class Utility {\n"
    "    public String formatDate(Date d) {\n"
    "        String fmt = BaseController.DEFAULT_FORMAT;\n"
    "        return String.valueOf(d) + ' (' + fmt + ')';\n"
    "    }\n"
    "}\n"
))

write_cls("AccountService", (
    "public class AccountService implements Loggable {\n"
    "    public static Account getById(Id accountId) {\n"
    "        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];\n"
    "    }\n\n"
    "    public void log(String message) {\n"
    "        Utility helper = new Utility();\n"
    "        System.debug(helper.formatDate(Date.today()) + ': ' + message);\n"
    "    }\n\n"
    "    public static Boolean isLoggable(Object obj) {\n"
    "        return obj instanceof Loggable;\n"
    "    }\n"
    "}\n"
))

# Regression test for a parser bug: an `implements` list where one entry is
# generic and/or namespaced (`Database.Batchable<sObject>`, `Database.Stateful`
# - an extremely common pairing for real Apex batch classes) used to make the
# *entire* implements list fail to parse, silently dropping the edge to
# Loggable too, not just the two system interfaces that aren't in this org.
write_cls("NightlyCleanupBatch", (
    "global class NightlyCleanupBatch implements Database.Batchable<sObject>, Database.Stateful, Loggable {\n"
    "    global Database.QueryLocator start(Database.BatchableContext bc) {\n"
    "        return Database.getQueryLocator([SELECT Id FROM Account]);\n"
    "    }\n\n"
    "    global void execute(Database.BatchableContext bc, List<Account> scope) {\n"
    "    }\n\n"
    "    global void finish(Database.BatchableContext bc) {\n"
    "    }\n\n"
    "    public void log(String message) {\n"
    "        System.debug('[NightlyCleanupBatch] ' + message);\n"
    "    }\n"
    "}\n"
))

write_cls("AccountController", (
    "public class AccountController extends BaseController {\n"
    "    @AuraEnabled(cacheable=true)\n"
    "    public static List<Account> getAccounts() {\n"
    "        return [SELECT Id, Name FROM Account LIMIT 100];\n"
    "    }\n\n"
    "    @AuraEnabled\n"
    "    public static Account getAccountDetail(Id accountId) {\n"
    "        return AccountService.getById(accountId);\n"
    "    }\n\n"
    "    public override void log(String message) {\n"
    "        System.debug('[AccountController] ' + message);\n"
    "    }\n"
    "}\n"
))

write_cls("ContactController", (
    "public class ContactController {\n"
    "    public static List<Contact> getContacts(Id accountId) {\n"
    "        return [SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = :accountId];\n"
    "    }\n\n"
    "    public static Contact getPrimaryContact(Id accountId) {\n"
    "        AccountService svc = new AccountService();\n"
    "        Account acct = AccountService.getById(accountId);\n"
    "        return acct != null ? getFirstContact(accountId) : null;\n"
    "    }\n\n"
    "    private static Contact getFirstContact(Id accountId) {\n"
    "        List<Contact> contacts = getContacts(accountId);\n"
    "        return contacts.isEmpty() ? null : contacts[0];\n"
    "    }\n"
    "}\n"
))

write_cls("AccountTriggerHandler", (
    "public class AccountTriggerHandler {\n"
    "    public static void handleBeforeInsert(List<Account> newAccounts) {\n"
    "        Utility helper = new Utility();\n"
    "        for (Account acct : newAccounts) {\n"
    "            System.debug(helper.formatDate(Date.today()));\n"
    "        }\n"
    "    }\n"
    "}\n"
))

(triggers / "AccountTrigger.trigger").write_text(
    "trigger AccountTrigger on Account (before insert, before update) {\n"
    "    AccountTriggerHandler.handleBeforeInsert(Trigger.new);\n"
    "}\n",
    encoding="utf-8",
)

# Isolated node - nothing calls it, it calls nothing known in this org.
write_cls("EmailService", (
    "public class EmailService {\n"
    "    public static void sendWelcomeEmail(String toAddress) {\n"
    "        System.debug('Sending welcome email to ' + toAddress);\n"
    "    }\n"
    "}\n"
))

# --- false-transitive-dependency scenario ---------------------------------
# ChainClassA only ever calls ChainClassB.methodTwo(), which doesn't touch
# ChainClassC. ChainClassB.methodThree() - a *different*, unrelated method -
# is the only thing that calls ChainClassC. Class-level edges alone
# (ChainClassA -> ChainClassB, ChainClassB -> ChainClassC) make it look like
# ChainClassA transitively depends on ChainClassC; the method-level graph
# should show that's false - no real call chain from ChainClassA ever
# reaches ChainClassC.

write_cls("ChainClassC", (
    "public class ChainClassC {\n"
    "    public String methodFour() {\n"
    "        return 'leaf';\n"
    "    }\n"
    "}\n"
))

write_cls("ChainClassB", (
    "public class ChainClassB {\n"
    "    public void methodTwo() {\n"
    "        System.debug('methodTwo does not call ChainClassC');\n"
    "    }\n\n"
    "    public void methodThree() {\n"
    "        ChainClassC c = new ChainClassC();\n"
    "        c.methodFour();\n"
    "    }\n"
    "}\n"
))

write_cls("ChainClassA", (
    "public class ChainClassA {\n"
    "    public void methodOne() {\n"
    "        ChainClassB b = new ChainClassB();\n"
    "        b.methodTwo();\n"
    "    }\n"
    "}\n"
))

# --- overload disambiguation ----------------------------------------------
# OverloadTarget.describe() and describe(String) are two different methods
# (different arity) that should not collapse onto one method node; a caller
# with 1 argument should resolve to describe(String), not both/neither.

write_cls("OverloadTarget", (
    "public class OverloadTarget {\n"
    "    public String describe() {\n"
    "        return 'no args';\n"
    "    }\n\n"
    "    public String describe(String label) {\n"
    "        return 'with label: ' + label;\n"
    "    }\n\n"
    "    // A third overload nobody calls - dead-code detection should flag just\n"
    "    // this one (arity 2), not the other two live overloads of the same name.\n"
    "    public String describe(String label, Boolean verbose) {\n"
    "        return verbose ? ('verbose: ' + label) : label;\n"
    "    }\n"
    "}\n"
))

write_cls("OverloadCaller", (
    "public class OverloadCaller {\n"
    "    public String callWithLabel() {\n"
    "        OverloadTarget t = new OverloadTarget();\n"
    "        return t.describe('hello');\n"
    "    }\n"
    "}\n"
))

# --- polymorphic dispatch --------------------------------------------------
# PolyCaller.run(PolyBase) only ever sees the *declared* type PolyBase, but
# the actual object handed to it at runtime could be any override - the
# graph should fan the call out to both PolyChildOne.describe() and
# PolyChildTwo.describe() as `possible_override` edges, not just
# PolyBase.describe().

write_cls("PolyBase", (
    "public virtual class PolyBase {\n"
    "    public virtual String describe() {\n"
    "        return 'base';\n"
    "    }\n"
    "}\n"
))

write_cls("PolyChildOne", (
    "public class PolyChildOne extends PolyBase {\n"
    "    public override String describe() {\n"
    "        return 'child one';\n"
    "    }\n"
    "}\n"
))

write_cls("PolyChildTwo", (
    "public class PolyChildTwo extends PolyBase {\n"
    "    public override String describe() {\n"
    "        return 'child two';\n"
    "    }\n"
    "}\n"
))

write_cls("PolyCaller", (
    "public class PolyCaller {\n"
    "    public void run(PolyBase item) {\n"
    "        System.debug(item.describe());\n"
    "    }\n"
    "}\n"
))

# --- exact-type call (constructor-chained) should NOT trigger fan-out ------
# Unlike PolyCaller above, this calls describe() directly off a freshly
# constructed `new PolyBase()` - the concrete type is exactly PolyBase, not
# merely declared-as-PolyBase the way a variable/field/param is, so there's
# no runtime-type ambiguity to speculate about. The graph should reach
# PolyBase itself but must NOT fan out possible_override edges to
# PolyChildOne/PolyChildTwo the way PolyCaller's call does.

write_cls("ExactTypePolyCaller", (
    "public class ExactTypePolyCaller {\n"
    "    public String run() {\n"
    "        return new PolyBase().describe();\n"
    "    }\n"
    "}\n"
))

# --- polymorphic dispatch through an interface ------------------------------
# NotifierRunner.alertAll(NotifierIface) only ever sees the *declared*
# interface type - unlike the extends/override case above, Apex interface
# methods have no default body, so *every* implementer (not just ones
# flagged `override`) is a fan-out candidate. The graph should fan the call
# out to both EmailNotifier.notify() and SmsNotifier.notify() as
# `possible_implementation` edges - neither implementer is ever `new`'d
# anywhere in this fixture, so this is the only way either becomes reachable
# from NotifierRunner at all.

write_cls("NotifierIface", (
    "public interface NotifierIface {\n"
    "    void notify(String message);\n"
    "}\n"
))

write_cls("EmailNotifier", (
    "public class EmailNotifier implements NotifierIface {\n"
    "    public void notify(String message) {\n"
    "        System.debug('email: ' + message);\n"
    "    }\n"
    "}\n"
))

write_cls("SmsNotifier", (
    "public class SmsNotifier implements NotifierIface {\n"
    "    public void notify(String message) {\n"
    "        System.debug('sms: ' + message);\n"
    "    }\n"
    "}\n"
))

write_cls("NotifierRunner", (
    "public class NotifierRunner {\n"
    "    public void alertAll(NotifierIface notifier) {\n"
    "        notifier.notify('hello');\n"
    "    }\n"
    "}\n"
))

# --- fluent call chained directly off `new` ---------------------------------
# ReportRunner.run() never assigns `new ReportBuilder()` to a variable - it
# calls .build() directly on the freshly-constructed instance. A parser bug
# used to record only the `instantiation` edge and silently drop the
# chained .build() call (and its method-level edge) entirely.

write_cls("ReportBuilder", (
    "public class ReportBuilder {\n"
    "    public String build() {\n"
    "        return 'report';\n"
    "    }\n"
    "}\n"
))

write_cls("ReportRunner", (
    "public class ReportRunner {\n"
    "    public String run() {\n"
    "        return new ReportBuilder().build();\n"
    "    }\n"
    "}\n"
))

# --- multi-variable declaration --------------------------------------------
# `Utility first, second;` declares two locals in one statement - a parser
# bug used to map only `first` (the one immediately after the type) to
# Utility, leaving `second` unresolvable, so a call through `second` alone
# was silently dropped.

write_cls("MultiDeclCaller", (
    "public class MultiDeclCaller {\n"
    "    public void run() {\n"
    "        Utility first, second;\n"
    "        second = new Utility();\n"
    "        second.formatDate(Date.today());\n"
    "    }\n"
    "}\n"
))

# --- local-variable scope leak across methods -------------------------------
# useLocalVar() declares `AccountService accountService = ...` (the
# conventional Apex/Java "type name lowercased" variable name) - a parser bug
# used to flatten every method's local-variable declarations into one
# class-wide map, so that variable's mapping leaked into callStatic(), an
# unrelated method that never declares any such variable. There, the literal
# `AccountService.getById(...)` - a genuine static call - was misread as a
# call *through* that other method's variable and misclassified as an
# ambiguous instance_call, which could in turn spuriously trigger
# polymorphic-dispatch fan-out for a call that was never dispatch-ambiguous
# at all (static methods can't be virtual/override in Apex).

write_cls("StaticCallScopeCaller", (
    "public class StaticCallScopeCaller {\n"
    "    public void useLocalVar() {\n"
    "        AccountService accountService = new AccountService();\n"
    "        accountService.log('hi');\n"
    "    }\n\n"
    "    public void callStatic() {\n"
    "        AccountService.getById(null);\n"
    "    }\n"
    "}\n"
))

# --- dead-code detection ---------------------------------------------------
# Exercises get_dead_code(): usedMethod() has a real caller (stays off both
# lists); unusedMethod() has none anywhere (-> dead); testOnlyMethod() is
# only called from AccountControllerTest below (-> test_only); the
# constructor, the @AuraEnabled method, and the @InvocableMethod method all
# have zero callers too but must be excluded as known entry points rather
# than flagged dead.

write_cls("DeadCodeSample", (
    "public class DeadCodeSample {\n"
    "    public DeadCodeSample() {\n"
    "    }\n\n"
    "    public String usedMethod() {\n"
    "        return 'called from DeadCodeSampleCaller';\n"
    "    }\n\n"
    "    public String unusedMethod() {\n"
    "        return 'never called from anywhere in this org';\n"
    "    }\n\n"
    "    public static String testOnlyMethod() {\n"
    "        return 'called only from AccountControllerTest';\n"
    "    }\n\n"
    "    @AuraEnabled\n"
    "    public static String getUnusedAuraMethod() {\n"
    "        return 'exposed to Lightning, no direct Apex/LWC caller';\n"
    "    }\n\n"
    "    @InvocableMethod(label='Unused Invocable')\n"
    "    public static void unusedInvocableMethod() {\n"
    "        System.debug('invoked only by a Flow, never from Apex');\n"
    "    }\n"
    "}\n"
))

write_cls("DeadCodeSampleCaller", (
    "public class DeadCodeSampleCaller {\n"
    "    public String run() {\n"
    "        DeadCodeSample sample = new DeadCodeSample();\n"
    "        return sample.usedMethod();\n"
    "    }\n"
    "}\n"
))

# Type.forName('LiteralClassName') resolution: ReflectivelyInstantiated is
# never `new`'d directly anywhere - the only path to it is
# ReflectionFactory's reflective build() - so it pressure-tests the
# dynamic_instantiation edge described in apex_parser.py. Its own
# identify() method is still correctly reported dead: being reachable via
# reflection proves the *class* gets instantiated, not that any particular
# method on it is ever called.

write_cls("ReflectivelyInstantiated", (
    "public class ReflectivelyInstantiated {\n"
    "    public String identify() {\n"
    "        return 'built via Type.forName';\n"
    "    }\n"
    "}\n"
))

write_cls("ReflectionFactory", (
    "public class ReflectionFactory {\n"
    "    public Object build() {\n"
    "        Type t = Type.forName('ReflectivelyInstantiated');\n"
    "        return t.newInstance();\n"
    "    }\n"
    "}\n"
))

# A second platform-interface entry point, deliberately *not* `global`
# (unlike NightlyCleanupBatch above) - NightlyCleanupBatch's start/execute/
# finish are also `global`, so their entry_point_reason actually comes from
# the `global` modifier check, not the Batchable/Schedulable/Queueable
# interface check (the modifier check runs first - see graph_builder's
# precedence). This class's plain `public` execute() has no annotation and
# no `global` modifier, so it's the one that actually exercises the
# interface-based fallback (reason should read "Schedulable.execute").
write_cls("ScheduledCleanupJob", (
    "public class ScheduledCleanupJob implements Schedulable {\n"
    "    public void execute(SchedulableContext sc) {\n"
    "        System.debug('scheduled run');\n"
    "    }\n"
    "}\n"
))

# --- dead-code gallery: every kind/format we could think of ----------------
# A broader survey than the DeadCodeSample block above, one small
# class-pair per pattern, each documenting what get_dead_code() currently
# does with it - correctly flagged, correctly excluded, or a known false
# negative (the parser sees a real textual call, but it isn't one at
# runtime). Not all of these are "fixed" by this tool; some are here to make
# an accepted limitation concrete and checkable instead of theoretical.

# 1) A whole legacy class, multiple dead methods (public and private),
# nothing in the org references the class or any method on it at all.
write_cls("LegacyReportGenerator", (
    "public class LegacyReportGenerator {\n"
    "    public String buildSummary() {\n"
    "        return 'summary';\n"
    "    }\n\n"
    "    public String buildDetail(Id recordId) {\n"
    "        return 'detail for ' + recordId;\n"
    "    }\n\n"
    "    private void logGeneration() {\n"
    "        System.debug('report generated');\n"
    "    }\n"
    "}\n"
))

# 2) A dead private method sitting right next to live ones in an otherwise
# actively-used class - the realistic "nobody noticed this helper stopped
# being called" case, as opposed to a whole class going dark.
write_cls("ReportAccessGate", (
    "public class ReportAccessGate {\n"
    "    public Boolean canAccess(Id userId) {\n"
    "        return checkPermission(userId);\n"
    "    }\n\n"
    "    private Boolean checkPermission(Id userId) {\n"
    "        return userId != null;\n"
    "    }\n\n"
    "    private Boolean checkLegacyPermission(Id userId) {\n"
    "        return true;\n"
    "    }\n"
    "}\n"
))

write_cls("ReportAccessGateCaller", (
    "public class ReportAccessGateCaller {\n"
    "    public Boolean run(Id userId) {\n"
    "        ReportAccessGate gate = new ReportAccessGate();\n"
    "        return gate.canAccess(userId);\n"
    "    }\n"
    "}\n"
))

# 2b) The other two same-class-call forms ReportAccessGate doesn't cover:
# an explicit `this.` qualifier, and a call through a *variable typed as
# this class itself* (as opposed to a bare unqualified call). Both used to
# be silently invisible the same way the bare form was.
write_cls("ThisQualifiedCaller", (
    "public class ThisQualifiedCaller {\n"
    "    public String run() {\n"
    "        return this.helper();\n"
    "    }\n\n"
    "    private String helper() {\n"
    "        return 'helped';\n"
    "    }\n"
    "}\n"
))

write_cls("SelfTypedVariableCaller", (
    "public class SelfTypedVariableCaller {\n"
    "    public String run() {\n"
    "        SelfTypedVariableCaller other = new SelfTypedVariableCaller();\n"
    "        return other.helper();\n"
    "    }\n\n"
    "    public String helper() {\n"
    "        return 'helped via a same-type variable';\n"
    "    }\n"
    "}\n"
))

# 3) The only "call" is commented out (both // and /* */ forms) - confirms
# strip_comments_and_strings runs *before* the reference scan, so this must
# still be flagged dead, not miscounted as used.
write_cls("CommentedOutCaller", (
    "public class CommentedOutCaller {\n"
    "    public void run() {\n"
    "        // NeverCalledFromComment.ping();\n"
    "        /* NeverCalledFromComment.ping(); */\n"
    "        System.debug('nothing real happens here');\n"
    "    }\n"
    "}\n"
))

write_cls("NeverCalledFromComment", (
    "public class NeverCalledFromComment {\n"
    "    public static void ping() {\n"
    "        System.debug('ping');\n"
    "    }\n"
    "}\n"
))

# 4) The method name only ever appears inside a string literal (e.g. a
# docstring-style hint), never as real code - must not be misread as a call.
write_cls("StringMentionCaller", (
    "public class StringMentionCaller {\n"
    "    public String run() {\n"
    "        return 'Call StringMentionTarget.ping() manually if needed';\n"
    "    }\n"
    "}\n"
))

write_cls("StringMentionTarget", (
    "public class StringMentionTarget {\n"
    "    public static void ping() {\n"
    "        System.debug('ping');\n"
    "    }\n"
    "}\n"
))

# 5) KNOWN FALSE NEGATIVE - polymorphic fan-out masks a dead override.
# ShapeRunner.describe(ShapeBase) calls shape.area() through the *declared*
# base type, so graph_builder's possible_override fan-out (see
# graph_builder.py Pass 2) speculatively wires up EVERY override of area()
# in the org - Circle, Square, AND Triangle - regardless of whether that
# subclass is ever actually `new`'d anywhere. None of the three will show up
# as dead, even though (in this fixture) none of them is ever instantiated
# either - fan-out only asks "does some override of this method exist
# somewhere in the hierarchy", not "could this specific subclass's instance
# actually reach this call site". A real dead override hiding behind a live
# polymorphic call site is invisible to this tool today.
write_cls("ShapeBase", (
    "public virtual class ShapeBase {\n"
    "    public virtual String area() {\n"
    "        return '0';\n"
    "    }\n"
    "}\n"
))

write_cls("Circle", (
    "public class Circle extends ShapeBase {\n"
    "    public override String area() {\n"
    "        return 'pi*r*r';\n"
    "    }\n"
    "}\n"
))

write_cls("Square", (
    "public class Square extends ShapeBase {\n"
    "    public override String area() {\n"
    "        return 's*s';\n"
    "    }\n"
    "}\n"
))

write_cls("Triangle", (
    "public class Triangle extends ShapeBase {\n"
    "    public override String area() {\n"
    "        return '0.5*b*h';\n"
    "    }\n"
    "}\n"
))

write_cls("ShapeRunner", (
    "public class ShapeRunner {\n"
    "    public String describe(ShapeBase shape) {\n"
    "        return shape.area();\n"
    "    }\n"
    "}\n"
))

# 6) Call made from a class-level field initializer, outside every method
# body (find_method_spans never sees it as "inside" a method - scope_key is
# _FIELD_SCOPE) - the target must still resolve as used, attributed to the
# class itself rather than a fabricated enclosing method.
write_cls("StaticInitCaller", (
    "public class StaticInitCaller {\n"
    "    private static final String CONFIG_LABEL = StaticInitTarget.buildLabel();\n"
    "}\n"
))

write_cls("StaticInitTarget", (
    "public class StaticInitTarget {\n"
    "    public static String buildLabel() {\n"
    "        return 'label';\n"
    "    }\n"
    "}\n"
))

# 7) KNOWN FALSE NEGATIVE - a call inside a permanently-false branch. This
# parser does textual call-graph analysis, not control-flow/reachability
# analysis, so neverActuallyRuns() reads as used even though `if (false)`
# means it can never run in practice.
write_cls("DeadBranchCaller", (
    "public class DeadBranchCaller {\n"
    "    public void run() {\n"
    "        if (false) {\n"
    "            DeadBranchTarget.neverActuallyRuns();\n"
    "        }\n"
    "    }\n"
    "}\n"
))

write_cls("DeadBranchTarget", (
    "public class DeadBranchTarget {\n"
    "    public static void neverActuallyRuns() {\n"
    "        System.debug('unreachable in practice, but this parser cannot tell');\n"
    "    }\n"
    "}\n"
))

# 9) KNOWN FALSE NEGATIVE - transitively dead across a class boundary.
# Nothing calls OrphanedLegacyCaller.run() - it's correctly flagged dead.
# But OrphanedLegacyTarget.doWork() has a real caller (OrphanedLegacyCaller),
# so get_dead_code()'s in_degree==0 check reports it as used - even though
# the *entire two-class chain* is unreachable from anything actually live.
# This tool does a one-hop "does anything call this" check, not a
# reachability/mark-and-sweep pass from live entry points, so a method whose
# only caller is itself dead reads as used. A dead method calling a "live"
# one doesn't make the callee dead either, for the same reason in reverse.
write_cls("OrphanedLegacyCaller", (
    "public class OrphanedLegacyCaller {\n"
    "    public void run() {\n"
    "        OrphanedLegacyTarget.doWork();\n"
    "    }\n"
    "}\n"
))

write_cls("OrphanedLegacyTarget", (
    "public class OrphanedLegacyTarget {\n"
    "    public static void doWork() {\n"
    "        System.debug('work done, but nobody sane still calls this chain');\n"
    "    }\n"
    "}\n"
))

# 10) KNOWN FALSE NEGATIVE - a mutually-referential dead pair. DeadLoopA.ping()
# and DeadLoopB.pong() call each other and nothing else in the org calls
# either one - the pair is completely unreachable from any live entry point,
# but each has in_degree=1 (from the other), so neither is ever flagged.
# The cleanest possible demonstration that in_degree==0 is a *local*
# check, not a global reachability analysis - a closed loop of dead code
# calling itself will never show in_degree==0 no matter how large the loop.
write_cls("DeadLoopA", (
    "public class DeadLoopA {\n"
    "    public void ping() {\n"
    "        DeadLoopB looper = new DeadLoopB();\n"
    "        looper.pong();\n"
    "    }\n"
    "}\n"
))

write_cls("DeadLoopB", (
    "public class DeadLoopB {\n"
    "    public void pong() {\n"
    "        DeadLoopA looper = new DeadLoopA();\n"
    "        looper.ping();\n"
    "    }\n"
    "}\n"
))

# 11) A dead method living beside a live one in a trigger handler - the
# trigger only wires handleBeforeInsert; handleBeforeUpdate lost its wiring
# (or never had any) and is a real dead-code candidate, same shape as
# AccountTriggerHandler's fully-wired case but with one method left behind.
write_cls("OpportunityTriggerHandler", (
    "public class OpportunityTriggerHandler {\n"
    "    public static void handleBeforeInsert(List<Opportunity> newOpps) {\n"
    "        System.debug('before insert: ' + newOpps.size());\n"
    "    }\n\n"
    "    public static void handleBeforeUpdate(List<Opportunity> newOpps) {\n"
    "        System.debug('before update: ' + newOpps.size());\n"
    "    }\n"
    "}\n"
))

(triggers / "OpportunityTrigger.trigger").write_text(
    "trigger OpportunityTrigger on Opportunity (before insert) {\n"
    "    OpportunityTriggerHandler.handleBeforeInsert(Trigger.new);\n"
    "}\n",
    encoding="utf-8",
)

# 12) @future - another annotated entry point (invoked by the async
# executor), same exclusion family as @AuraEnabled/@InvocableMethod but not
# yet covered by a fixture class of its own.
write_cls("AsyncNotifier", (
    "public class AsyncNotifier {\n"
    "    @future\n"
    "    public static void notifyAsync(String recordId) {\n"
    "        System.debug('notifying async for ' + recordId);\n"
    "    }\n"
    "}\n"
))

# 13) @RemoteAction - legacy Visualforce remoting entry point, same
# exclusion family, also not yet covered by a fixture class of its own.
write_cls("LegacyRemoteController", (
    "public class LegacyRemoteController {\n"
    "    @RemoteAction\n"
    "    public static String legacyRemoteMethod(String input) {\n"
    "        return 'echo: ' + input;\n"
    "    }\n"
    "}\n"
))

# 14) Custom REST API endpoints (@HttpGet/@HttpPost/...) - a genuine
# external entry point, same family as @AuraEnabled/@RemoteAction. Salesforce
# requires these methods to be `global static` too, so "global modifier"
# would already exclude them either way - this fixture mainly proves the
# more specific @HttpGet/@HttpPost label wins over the generic one (checked
# first in _ENTRY_POINT_CHECKS), which is more informative to a reader than
# just "global modifier".
write_cls("LegacyOrderRestResource", (
    "@RestResource(urlMapping='/legacyOrders/*')\n"
    "global class LegacyOrderRestResource {\n"
    "    @HttpGet\n"
    "    global static String getOrder() {\n"
    "        return 'order';\n"
    "    }\n\n"
    "    @HttpPost\n"
    "    global static void createOrder() {\n"
    "        System.debug('creating order');\n"
    "    }\n"
    "}\n"
))

# 15) `webservice` - legacy SOAP API exposure. Unlike @HttpGet/@RemoteAction,
# a webservice method's own signature does NOT also carry the literal word
# "global" (only the *class* declaration does, a separate buffer this
# per-method scan never sees) - so this one genuinely was a false-positive
# gap before its own check existed, not just a clarity improvement.
write_cls("LegacyWebServiceProvider", (
    "global class LegacyWebServiceProvider {\n"
    "    webservice static String legacySoapMethod(String input) {\n"
    "        return 'echo: ' + input;\n"
    "    }\n"
    "}\n"
))

# 16) Platform-interface exclusion must be arity-aware, not name-only - a
# Queueable class that also happens to declare an unrelated, genuinely dead
# `execute(String)` overload (same name, different arity than the real
# `execute(QueueableContext)`) must NOT get a free pass just for sharing the
# platform callback's name.
write_cls("QueueableWithDeadOverload", (
    "public class QueueableWithDeadOverload implements Queueable {\n"
    "    public void execute(QueueableContext qc) {\n"
    "        System.debug('real Queueable callback');\n"
    "    }\n\n"
    "    // Same name as the platform callback, but arity 2 (not 1 like the\n"
    "    // real Queueable.execute(QueueableContext)) - a plain unrelated\n"
    "    // helper that happens to be named `execute` too, and nobody ever\n"
    "    // calls it.\n"
    "    public void execute(String reason, Boolean flag) {\n"
    "        System.debug('dead overload: ' + reason);\n"
    "    }\n"
    "}\n"
))

# 17) Same idea as #16, but the *same-arity* case (1 param either way) with
# the dead overload declared FIRST and the real platform callback SECOND -
# regression test for the entry_point_reason "upgrade" fix in graph_builder.
# Apex method nodes are keyed by name+arity, not full signature, so these two
# `execute` overloads (String vs QueueableContext, both arity 1) collapse
# onto ONE method node - which occurrence's info wins used to depend purely
# on declaration order (whichever span graph_builder saw first). Regardless
# of order, the merged node must end up excluded as a known entry point: the
# real callback exists somewhere among the colliding declarations, and that
# should be enough.
write_cls("ReversedOrderQueueable", (
    "public class ReversedOrderQueueable implements Queueable {\n"
    "    // Declared FIRST, but this is NOT the real platform callback (same\n"
    "    // arity, different parameter type).\n"
    "    public void execute(String reason) {\n"
    "        System.debug('dead overload, declared before the real callback: ' + reason);\n"
    "    }\n\n"
    "    // The real platform callback, declared SECOND.\n"
    "    public void execute(QueueableContext qc) {\n"
    "        System.debug('real Queueable callback');\n"
    "    }\n"
    "}\n"
))

# --- overload resolution must not be fooled by an unspaced comparison ------
# `pick(counter<max, true)` is 2 real arguments - `counter<max` is a
# comparison, not a generic type argument, even though it has no spaces
# around `<` (a common style in tight loop/guard conditions). A parser bug
# used to assume any `<` immediately after an identifier char opens a
# generic and never gave up looking for a matching `>`, so it silently
# swallowed the rest of the argument list - miscounting this as 1 argument
# and resolving the call to the WRONG overload (pick(Integer) instead of
# pick(Integer, Boolean)), rather than either resolving correctly or at
# least failing closed.
write_cls("ArityGuardTarget", (
    "public class ArityGuardTarget {\n"
    "    // Never actually called - regression test that the miscounted call\n"
    "    // below doesn't wrongly resolve here.\n"
    "    public String pick(Integer a) {\n"
    "        return 'wrong arm - should never be reached';\n"
    "    }\n\n"
    "    public String pick(Integer a, Boolean flag) {\n"
    "        return 'right arm - genuinely called with 2 arguments';\n"
    "    }\n"
    "}\n"
))

write_cls("ArityGuardCaller", (
    "public class ArityGuardCaller {\n"
    "    public String run(Integer counter, Integer max) {\n"
    "        ArityGuardTarget t = new ArityGuardTarget();\n"
    "        return t.pick(counter<max, true);\n"
    "    }\n"
    "}\n"
))

# --- dot-qualified call vs. bare same-class call name collision ------------
# `helper.process()` (a call on a DIFFERENT class's instance) and a bare
# same-class call to this class's OWN `process()` look identical once you
# strip whitespace: both are just the identifier "process" immediately
# followed by "(". A parser bug used to tell them apart only by checking
# whether the *receiver* (`helper`) resolved to a known type/variable - it
# never checked whether "process" itself was immediately preceded by a `.`,
# so whenever the CALLING class also happened to declare its own
# same-named method, the call was misattributed as a phantom same-class
# self-call. DotQualifiedNameCollision.process() is never really called by
# anything - only DotQualifiedHelper.process() is - so before the fix,
# DotQualifiedNameCollision.process() incorrectly looked "used" (by
# itself) and never showed up as dead.
write_cls("DotQualifiedHelper", (
    "public class DotQualifiedHelper {\n"
    "    public void process() {\n"
    "        System.debug('genuinely called from DotQualifiedNameCollision.caller()');\n"
    "    }\n"
    "}\n"
))

write_cls("DotQualifiedNameCollision", (
    "public class DotQualifiedNameCollision {\n"
    "    // Never actually called by anything - regression test that calling\n"
    "    // a DIFFERENT class's same-named method doesn't give this one a\n"
    "    // phantom self-call.\n"
    "    public void process() {\n"
    "        System.debug('should be flagged dead');\n"
    "    }\n\n"
    "    public void caller() {\n"
    "        DotQualifiedHelper helper = new DotQualifiedHelper();\n"
    "        helper.process();\n"
    "    }\n"
    "}\n"
))

# Same root cause, the `super.` case: only `this.` was special-cased as an
# explicit same-class qualifier, so `super.handle()` fell through to the
# same bare-call heuristic - word_lower "handle" immediately followed by
# "(", matching THIS class's own (overriding) method name, misread as a
# same-class call to itself. SuperCallChild.handle() is never called by
# anything real (nothing anywhere constructs a SuperCallBase-typed
# reference that could dispatch to it) - before the fix, `super.handle()`
# inside its own override body gave it a phantom self-loop that made it
# look used.
#
# SuperCallBase.handle() itself used to be a separate, still-open gap: with
# "super" special-cased as neither a declared local/field nor an org type,
# `super.handle()` fell through EVERY branch with no occurrence emitted at
# any level (not even the phantom self-loop above) - a superclass method
# called only via `super.x()` in an override read as dead code, 0 in-degree,
# despite being invoked on every call to the override. Now resolved directly
# against this type's own `extends` target (a real, single-hop, non-virtual
# lookup - `super.x()` always calls the exact base implementation, so no
# possible_override fan-out either).
write_cls("SuperCallBase", (
    "public virtual class SuperCallBase {\n"
    "    public virtual void handle() {\n"
    "        System.debug('base handling');\n"
    "    }\n"
    "}\n"
))

write_cls("SuperCallChild", (
    "public class SuperCallChild extends SuperCallBase {\n"
    "    // Never actually called by anything - regression test that\n"
    "    // super.handle() doesn't give this a phantom self-loop.\n"
    "    public override void handle() {\n"
    "        super.handle();\n"
    "        System.debug('child handling');\n"
    "    }\n"
    "}\n"
))

# --- duplicate-named class: its own unique methods must not vanish ---------
# Two files declaring the same top-level type name "DuplicatedPolicy" (e.g. a
# stray backup copy, or two org exports merged into one folder) - keeping the
# first occurrence's class-level identity is the existing, deliberate policy
# (see graph_builder's duplicate handling), but a bug used to also skip
# registering the DUPLICATE file's own methods entirely: a method that exists
# ONLY in the duplicate file (not also declared, under the same name+arity,
# in the first occurrence) never got a node at all - not flagged dead, not
# flagged alive, simply absent from the whole graph and invisible to
# dead-code detection. secondOccurrenceOnlyMethod() below exists only in the
# second file and is never called by anything - it must now show up as a
# real dead-code candidate instead of disappearing.
write_cls("DuplicatedPolicy", (
    "public class DuplicatedPolicy {\n"
    "    public void firstOccurrenceMethod() {\n"
    "        System.debug('called from DuplicatedPolicyCaller');\n"
    "    }\n"
    "}\n"
))

_duplicate_dir = classes / "legacy_duplicates"
_duplicate_dir.mkdir(parents=True, exist_ok=True)
(_duplicate_dir / "DuplicatedPolicy.cls").write_text(
    "public class DuplicatedPolicy {\n"
    "    // Exists ONLY in this duplicate-named file.\n"
    "    public void secondOccurrenceOnlyMethod() {\n"
    "        System.debug('should be flagged dead, not silently invisible');\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

write_cls("DuplicatedPolicyCaller", (
    "public class DuplicatedPolicyCaller {\n"
    "    public void run() {\n"
    "        DuplicatedPolicy p = new DuplicatedPolicy();\n"
    "        p.firstOccurrenceMethod();\n"
    "    }\n"
    "}\n"
))

# --- nested classes ---------------------------------------------------------
# NestedWrapperController.Wrapper is the extremely common real-world pattern
# (an @AuraEnabled controller returning an inner DTO/wrapper class) - exercises
# a node + its own methods for a class *nested inside* another class, the
# same-class-call fix applying independently within the nested type
# (populate() -> buildName(), both on Wrapper, not on the outer controller),
# and dead-code detection correctly isolating unusedHelper() as Wrapper's own
# dead method rather than attributing it to (or hiding it inside) the outer
# class. NestedWrapperExternalCaller exercises both ways another file can
# reference the nested type - bare (`Wrapper`, relying on the same
# same-outer-class-implied bare registration real Apex code uses) and fully
# qualified (`NestedWrapperController.Wrapper`) - the qualified form used to
# be misparsed: `new Outer.Inner()` wrongly emitted an instantiation edge onto
# Outer itself, and `Outer.Inner` spelled out as a bare type (no `new`, e.g. a
# return type) was misread as a field access on Outer for a field literally
# named "Inner".
write_cls("NestedWrapperController", (
    "public class NestedWrapperController {\n"
    "    @AuraEnabled\n"
    "    public static Wrapper getWrapper() {\n"
    "        Wrapper w = new Wrapper();\n"
    "        w.populate();\n"
    "        return w;\n"
    "    }\n\n"
    "    public class Wrapper {\n"
    "        @AuraEnabled\n"
    "        public String name;\n\n"
    "        public void populate() {\n"
    "            name = buildName();\n"
    "        }\n\n"
    "        private String buildName() {\n"
    "            return 'built';\n"
    "        }\n\n"
    "        private String unusedHelper() {\n"
    "            return 'never called from anywhere, including within Wrapper itself';\n"
    "        }\n"
    "    }\n"
    "}\n"
))

write_cls("NestedWrapperExternalCaller", (
    "public class NestedWrapperExternalCaller {\n"
    "    public NestedWrapperController.Wrapper buildQualified() {\n"
    "        return new NestedWrapperController.Wrapper();\n"
    "    }\n\n"
    "    public Wrapper buildBare() {\n"
    "        return new Wrapper();\n"
    "    }\n"
    "}\n"
))

# OuterWithNestedCaller.helper() is called ONLY from its own nested type,
# unqualified (`helper()`, not `OuterWithNestedCaller.helper()`) - legal
# Apex, since a nested class can reach its enclosing type's static members
# without qualification. Regression fixture for a real bug: same-class bare-
# call resolution (self_method_names in apex_parser.py) used to be built
# from ONLY the type actually being scanned - graph_builder scans each
# nested type in its own isolated slice, so from inside
# NestedNoQualifierCaller's own scan, "helper" matched neither a declared
# local/org type NOR any of ITS OWN methods, and the call vanished with no
# occurrence at any level. helper() used to read as dead - 0 in-degree -
# despite being invoked on every NestedNoQualifierCaller.build().
write_cls("OuterWithNestedCaller", (
    "public class OuterWithNestedCaller {\n"
    "    private static String helper() {\n"
    "        return 'formatted by the enclosing type';\n"
    "    }\n\n"
    "    public class NestedNoQualifierCaller {\n"
    "        public String build() {\n"
    "            return helper();\n"
    "        }\n"
    "    }\n"
    "}\n"
))

# AlphaContainer/BetaContainer: two unrelated outer classes that each declare
# their own nested class named "Info" - a same-named-nested-type collision.
# Regression fixture for a real bug: the bare form of a nested type's name is
# registered once, globally, in apex_symbol_table (first file processed
# wins) - without graph_builder.py's per-file `file_symbol_table` override,
# whichever of these two files lost that race would have its own bare
# `Info`/`new Info()` misresolve onto the OTHER class's Info node (a wrong
# edge, not just a missing one). Each class's own build() must resolve to
# its OWN nested Info, regardless of which file the scanner happens to
# process first.
write_cls("AlphaContainer", (
    "public class AlphaContainer {\n"
    "    public Info build() {\n"
    "        Info i = new Info();\n"
    "        i.label = 'alpha';\n"
    "        return i;\n"
    "    }\n\n"
    "    public class Info {\n"
    "        public String label;\n"
    "    }\n"
    "}\n"
))

write_cls("BetaContainer", (
    "public class BetaContainer {\n"
    "    public Info build() {\n"
    "        Info i = new Info();\n"
    "        i.label = 'beta';\n"
    "        return i;\n"
    "    }\n\n"
    "    public class Info {\n"
    "        public String label;\n"
    "    }\n"
    "}\n"
))

# --- test-only classes ---------------------------------------------------
# Exercises the @isTest / testMethod detection used to keep test-fixture
# noise (e.g. every test class calling a shared TestDataFactory) out of the
# default graph view. TestDataFactory and AccountControllerTest are both
# whole @isTest classes; LegacyUtilityTest is a *non*-@isTest class with one
# legacy `testMethod`-modifier method, so only that method's edge should be
# treated as test-only, not the class itself.

write_cls("TestDataFactory", (
    "@isTest\n"
    "public class TestDataFactory {\n"
    "    public static Account createAccount() {\n"
    "        Account acct = new Account(Name = 'Test Account');\n"
    "        insert acct;\n"
    "        return acct;\n"
    "    }\n"
    "}\n"
))

write_cls("AccountControllerTest", (
    "@isTest\n"
    "private class AccountControllerTest {\n"
    "    @isTest\n"
    "    static void testGetAccounts() {\n"
    "        TestDataFactory.createAccount();\n"
    "        List<Account> results = AccountController.getAccounts();\n"
    "        System.assert(!results.isEmpty());\n"
    "    }\n\n"
    "    @isTest\n"
    "    static void testDeadCodeSampleTestOnlyMethod() {\n"
    "        String result = DeadCodeSample.testOnlyMethod();\n"
    "        System.assert(result != null);\n"
    "    }\n"
    "}\n"
))

write_cls("LegacyUtilityTest", (
    "public class LegacyUtilityTest {\n"
    "    static testMethod void testFormatDate() {\n"
    "        Utility helper = new Utility();\n"
    "        System.assert(helper.formatDate(Date.today()) != null);\n"
    "    }\n"
    "}\n"
))

# --- lwc -----------------------------------------------------------------

bundle(
    "accountCard",
    js=(
        "import { LightningElement, wire } from 'lwc';\n"
        "import getAccounts from '@salesforce/apex/AccountController.getAccounts';\n\n"
        "export default class AccountCard extends LightningElement {\n"
        "    @wire(getAccounts) accounts;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <lightning-card title=\"Accounts\">\n"
        "        <template for:each={accounts.data} for:item=\"acc\">\n"
        "            <p key={acc.Id}>{acc.Name}</p>\n"
        "        </template>\n"
        "    </lightning-card>\n"
        "</template>\n"
    ),
)

bundle(
    "contactList",
    js=(
        "import { LightningElement, api } from 'lwc';\n"
        "import getContacts from '@salesforce/apex/ContactController.getContacts';\n\n"
        "export default class ContactList extends LightningElement {\n"
        "    @api accountId;\n"
        "    contacts;\n\n"
        "    connectedCallback() {\n"
        "        getContacts({ accountId: this.accountId })\n"
        "            .then((data) => { this.contacts = data; })\n"
        "            .catch((error) => { console.error(error); });\n"
        "    }\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <template for:each={contacts} for:item=\"c\">\n"
        "        <p key={c.Id}>{c.FirstName} {c.LastName}</p>\n"
        "    </template>\n"
        "</template>\n"
    ),
)

bundle(
    "orderSummary",
    js=(
        "import { LightningElement, api } from 'lwc';\n"
        "import getAccountDetail from '@salesforce/apex/AccountController.getAccountDetail';\n\n"
        "export default class OrderSummary extends LightningElement {\n"
        "    @api orderId;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <p>Order: {orderId}</p>\n"
        "</template>\n"
    ),
)

bundle(
    "dashboardPage",
    js=(
        "import { LightningElement, api } from 'lwc';\n\n"
        "export default class DashboardPage extends LightningElement {\n"
        "    @api accountId;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <div class=\"dashboard\">\n"
        "        <c-account-card></c-account-card>\n"
        "        <c-contact-list account-id={accountId}></c-contact-list>\n"
        "    </div>\n"
        "</template>\n"
    ),
)

# 8) A fully orphaned LWC bundle - never wired, never imperatively called,
# never composed into any other component's template, nothing imports it.
# Out of scope for get_dead_code() today (Apex methods only, see
# graph_builder.py) - included here as the component-level analogue of
# EmailService's isolated-class case, for whenever LWC-level dead-code
# detection gets built.
bundle(
    "orphanWidget",
    js=(
        "import { LightningElement } from 'lwc';\n\n"
        "export default class OrphanWidget extends LightningElement {\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <p>Nobody wires, calls, or composes this component.</p>\n"
        "</template>\n"
    ),
)

# 18) Indirect platform-interface entry point: MyScheduledInterface is a
# custom interface that itself `extends Schedulable`, rather than a class
# implementing Schedulable directly. IndirectScheduledJob only implements
# MyScheduledInterface - never Schedulable by name - so its execute() is
# only recognized as a platform entry point via graph_builder's Pass 1.6
# (_transitive_interface_names walking implements -> extends); without
# that, this execute() would incorrectly read as dead code despite being a
# real platform callback, exactly the gap the README used to document as
# "not solved here."
write_cls("MyScheduledInterface", (
    "public interface MyScheduledInterface extends Schedulable {\n"
    "}\n"
))

write_cls("IndirectScheduledJob", (
    "public class IndirectScheduledJob implements MyScheduledInterface {\n"
    "    public void execute(SchedulableContext ctx) {\n"
    "        System.debug('run via a custom interface that itself extends Schedulable');\n"
    "    }\n"
    "}\n"
))

# 19) Root wiring for a handful of scenario "top of chain" callers defined
# above (DotQualifiedNameCollision.caller(), DuplicatedPolicyCaller.run(),
# DeadCodeSampleCaller.run(), OuterWithNestedCaller.NestedNoQualifierCaller.
# build()) - each of those fixtures exists to test something about their
# own CALLEE (a same-name collision, a duplicate-file method, a
# constructor, an unqualified same-enclosing-type call), not about whether
# the caller itself is reachable. Before get_dead_code() did real
# reachability (see README/graph_builder._compute_method_reachability), a
# caller with no caller of its own didn't matter - the callee still showed
# a direct in-degree of 1 and looked used regardless. Now that dead code
# genuinely has to trace back to a live root, each of those callers needs
# one too, the same way it would in a real org (a Trigger/LWC/Aura wiring
# this fixture doesn't otherwise model for them) - this single @AuraEnabled
# method is that root. DeadLoopA/DeadLoopB and OrphanedLegacyCaller are
# deliberately NOT included here - those two are the actual worked examples
# of code that stays genuinely unreachable.
write_cls("ScenarioEntryPoints", (
    "public class ScenarioEntryPoints {\n"
    "    @AuraEnabled\n"
    "    public static void wireUpScenarios() {\n"
    "        new DotQualifiedNameCollision().caller();\n"
    "        new DuplicatedPolicyCaller().run();\n"
    "        new DeadCodeSampleCaller().run();\n"
    "        // Bare (unqualified) form - `new Outer.Inner().method()`\n"
    "        // chained calls are a documented, narrow parser gap (see\n"
    "        // apex_parser.py); the bare nested-type name still resolves via\n"
    "        // the same fluent-chained-call-off-`new` handling every other\n"
    "        // unqualified `new X().method()` call in this fixture already uses.\n"
    "        new NestedNoQualifierCaller().build();\n"
    "    }\n"
    "}\n"
))

print("Fixture org created at", base)
for p in sorted(base.rglob("*")):
    if p.is_file():
        print(" ", p.relative_to(base.parent))

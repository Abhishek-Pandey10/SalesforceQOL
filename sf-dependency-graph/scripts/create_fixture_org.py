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
  apex_unused_import · composition (LWC-to-LWC)

plus one isolated class (EmailService) with no connections at all, so the
graph shows both a hub and a leaf.
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

print("Fixture org created at", base)
for p in sorted(base.rglob("*")):
    if p.is_file():
        print(" ", p.relative_to(base.parent))

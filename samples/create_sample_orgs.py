"""
Create sample org folders for testing apex-org-diff and lwc-org-diff.

Laid out like a real Salesforce DX project export - each org is one folder
containing a `classes/` and an `lwc/` subfolder - so both tools can point
at the same two org roots instead of needing separate per-tool fixtures:

    samples/
      org1/
        classes/*.cls
        lwc/<component>/...
      org2/
        classes/*.cls
        lwc/<component>/...
"""
import pathlib

base = pathlib.Path(__file__).parent


def bundle(root: pathlib.Path, name: str, *, js: str, html: str, css: str = None, meta: str = None) -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.js").write_text(js, encoding="utf-8")
    (d / f"{name}.html").write_text(html, encoding="utf-8")
    if css is not None:
        (d / f"{name}.css").write_text(css, encoding="utf-8")
    (d / f"{name}.js-meta.xml").write_text(
        meta or (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
            "    <apiVersion>59.0</apiVersion>\n"
            "    <isExposed>true</isExposed>\n"
            "    <targets>\n"
            "        <target>lightning__RecordPage</target>\n"
            "    </targets>\n"
            "</LightningComponentBundle>\n"
        ),
        encoding="utf-8",
    )


# =============================================================================
# ORG 1
# =============================================================================
org1 = base / "org1"
classes1 = org1 / "classes"
lwc1 = org1 / "lwc"
classes1.mkdir(parents=True, exist_ok=True)
lwc1.mkdir(parents=True, exist_ok=True)

# --- classes ---

(classes1 / "AccountController.cls").write_text(
    "public class AccountController {\n"
    "    @AuraEnabled(cacheable=true)\n"
    "    public static List<Account> getAccounts() {\n"
    "        return [SELECT Id, Name FROM Account LIMIT 100];\n"
    "    }\n\n"
    "    public static void oldMethod() {\n"
    "        System.debug('old logic');\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes1 / "AccountService.cls").write_text(
    "public class AccountService {\n"
    "    // Shared service - identical in both orgs\n"
    "    public static Account getById(Id accountId) {\n"
    "        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes1 / "ContactController.cls").write_text(
    "public class ContactController {\n"
    "    public static List<Contact> getContacts(Id accountId) {\n"
    "        return [SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes1 / "Utility.cls").write_text(
    "public class Utility {\n"
    "    // Only exists in Org A\n"
    "    public static String formatDate(Date d) {\n"
    "        return String.valueOf(d);\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

# Nested folder test
triggers1 = classes1 / "triggers"
triggers1.mkdir(exist_ok=True)
(triggers1 / "AccountTrigger.cls").write_text(
    "public class AccountTrigger {\n"
    "    public static void beforeInsert(List<Account> newAccounts) {}\n"
    "}\n",
    encoding="utf-8",
)

# Empty file test
(classes1 / "EmptyClass.cls").write_text("", encoding="utf-8")

# --- lwc ---

# Identical in both orgs
bundle(
    lwc1, "accountCard",
    js=(
        "import { LightningElement, api } from 'lwc';\n\n"
        "export default class AccountCard extends LightningElement {\n"
        "    @api accountId;\n\n"
        "    get hasAccount() {\n"
        "        return !!this.accountId;\n"
        "    }\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <lightning-card title=\"Account\">\n"
        "        <template if:true={hasAccount}>\n"
        "            <p>{accountId}</p>\n"
        "        </template>\n"
        "    </lightning-card>\n"
        "</template>\n"
    ),
    css=".card { padding: 0.5rem; }\n",
)

# Modified: js and html both change between orgs
bundle(
    lwc1, "contactList",
    js=(
        "import { LightningElement, wire } from 'lwc';\n"
        "import getContacts from '@salesforce/apex/ContactController.getContacts';\n\n"
        "export default class ContactList extends LightningElement {\n"
        "    @wire(getContacts) contacts;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <template for:each={contacts.data} for:item=\"c\">\n"
        "        <p key={c.Id}>{c.FirstName} {c.LastName}</p>\n"
        "    </template>\n"
        "</template>\n"
    ),
)

# Only in Org A (retired component)
bundle(
    lwc1, "orderSummary",
    js=(
        "import { LightningElement, api } from 'lwc';\n\n"
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

# Modified where the *file set* differs: org A has no CSS file for this one
bundle(
    lwc1, "productPicker",
    js=(
        "import { LightningElement } from 'lwc';\n\n"
        "export default class ProductPicker extends LightningElement {\n"
        "    selected = null;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <lightning-input label=\"Product\" onchange={handleChange}></lightning-input>\n"
        "</template>\n"
    ),
)

# Empty file edge case
emptyUtil1 = lwc1 / "emptyUtil"
emptyUtil1.mkdir(exist_ok=True)
(emptyUtil1 / "emptyUtil.js").write_text("", encoding="utf-8")
(emptyUtil1 / "emptyUtil.html").write_text("<template></template>\n", encoding="utf-8")
(emptyUtil1 / "emptyUtil.js-meta.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    "    <apiVersion>59.0</apiVersion>\n"
    "    <isExposed>false</isExposed>\n"
    "</LightningComponentBundle>\n",
    encoding="utf-8",
)

# =============================================================================
# ORG 2
# =============================================================================
org2 = base / "org2"
classes2 = org2 / "classes"
lwc2 = org2 / "lwc"
classes2.mkdir(parents=True, exist_ok=True)
lwc2.mkdir(parents=True, exist_ok=True)

# --- classes ---

(classes2 / "AccountController.cls").write_text(
    "public class AccountController {\n"
    "    @AuraEnabled(cacheable=true)\n"
    "    public static List<Account> getAccounts() {\n"
    "        return [SELECT Id, Name, Type FROM Account LIMIT 200];\n"
    "    }\n\n"
    "    public static void newMethod() {\n"
    "        System.debug('new logic added in sandbox');\n"
    "        System.debug('additional line');\n"
    "    }\n\n"
    "    @AuraEnabled\n"
    "    public static Account createAccount(String name) {\n"
    "        Account a = new Account(Name = name);\n"
    "        insert a;\n"
    "        return a;\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes2 / "AccountService.cls").write_text(
    "public class AccountService {\n"
    "    // Shared service - identical in both orgs\n"
    "    public static Account getById(Id accountId) {\n"
    "        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes2 / "ContactController.cls").write_text(
    "public class ContactController {\n"
    "    public static List<Contact> getContacts(Id accountId) {\n"
    "        return [SELECT Id, FirstName, LastName, Email FROM Contact"
    " WHERE AccountId = :accountId ORDER BY LastName];\n"
    "    }\n\n"
    "    @AuraEnabled\n"
    "    public static Contact getContactById(Id contactId) {\n"
    "        return [SELECT Id, FirstName, LastName, Email, Phone"
    " FROM Contact WHERE Id = :contactId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes2 / "NewClass.cls").write_text(
    "public class NewClass {\n"
    "    // Only exists in Org B - new feature\n"
    "    public static void newFeature() {\n"
    "        System.debug('New feature only in sandbox');\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(classes2 / "EmptyClass.cls").write_text("", encoding="utf-8")

# --- lwc ---

# Identical (same content as org1)
bundle(
    lwc2, "accountCard",
    js=(
        "import { LightningElement, api } from 'lwc';\n\n"
        "export default class AccountCard extends LightningElement {\n"
        "    @api accountId;\n\n"
        "    get hasAccount() {\n"
        "        return !!this.accountId;\n"
        "    }\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <lightning-card title=\"Account\">\n"
        "        <template if:true={hasAccount}>\n"
        "            <p>{accountId}</p>\n"
        "        </template>\n"
        "    </lightning-card>\n"
        "</template>\n"
    ),
    css=".card { padding: 0.5rem; }\n",
)

# Modified: extra wired method + a status filter added
bundle(
    lwc2, "contactList",
    js=(
        "import { LightningElement, wire, api } from 'lwc';\n"
        "import getContacts from '@salesforce/apex/ContactController.getContacts';\n\n"
        "export default class ContactList extends LightningElement {\n"
        "    @api accountId;\n\n"
        "    @wire(getContacts, { accountId: '$accountId' }) contacts;\n\n"
        "    get contactCount() {\n"
        "        return this.contacts?.data?.length ?? 0;\n"
        "    }\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <p>{contactCount} contacts</p>\n"
        "    <template for:each={contacts.data} for:item=\"c\">\n"
        "        <p key={c.Id}>{c.FirstName} {c.LastName} &mdash; {c.Email}</p>\n"
        "    </template>\n"
        "</template>\n"
    ),
)

# Only in Org B (new component)
bundle(
    lwc2, "dashboardTile",
    js=(
        "import { LightningElement, api } from 'lwc';\n\n"
        "export default class DashboardTile extends LightningElement {\n"
        "    @api metricLabel;\n"
        "    @api metricValue;\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <div class=\"tile\">\n"
        "        <p class=\"label\">{metricLabel}</p>\n"
        "        <p class=\"value\">{metricValue}</p>\n"
        "    </div>\n"
        "</template>\n"
    ),
    css=".tile { border: 1px solid #ccc; padding: 1rem; }\n",
)

# Modified where org B *adds* a CSS file the org A bundle didn't have
bundle(
    lwc2, "productPicker",
    js=(
        "import { LightningElement } from 'lwc';\n\n"
        "export default class ProductPicker extends LightningElement {\n"
        "    selected = null;\n\n"
        "    handleChange(event) {\n"
        "        this.selected = event.target.value;\n"
        "    }\n"
        "}\n"
    ),
    html=(
        "<template>\n"
        "    <lightning-input label=\"Product\" onchange={handleChange}></lightning-input>\n"
        "    <p if:true={selected}>Selected: {selected}</p>\n"
        "</template>\n"
    ),
    css=".selected { font-weight: bold; }\n",
)

# Empty file edge case (unchanged from org1 - should show as identical)
emptyUtil2 = lwc2 / "emptyUtil"
emptyUtil2.mkdir(exist_ok=True)
(emptyUtil2 / "emptyUtil.js").write_text("", encoding="utf-8")
(emptyUtil2 / "emptyUtil.html").write_text("<template></template>\n", encoding="utf-8")
(emptyUtil2 / "emptyUtil.js-meta.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    "    <apiVersion>59.0</apiVersion>\n"
    "    <isExposed>false</isExposed>\n"
    "</LightningComponentBundle>\n",
    encoding="utf-8",
)

print("Sample orgs created!")
for p in sorted(org1.rglob("*")):
    if p.is_file():
        print("  org1:", p.relative_to(base))
for p in sorted(org2.rglob("*")):
    if p.is_file():
        print("  org2:", p.relative_to(base))

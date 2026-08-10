"""Create sample LWC org folders for testing lwc-org-diff."""
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


# --- ORG 1 ---
org1 = base / "sample_lwc_org1"
org1.mkdir(exist_ok=True)

# Identical in both orgs
bundle(
    org1, "accountCard",
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
    org1, "contactList",
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
    org1, "orderSummary",
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
    org1, "productPicker",
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
(org1 / "emptyUtil").mkdir(exist_ok=True)
(org1 / "emptyUtil" / "emptyUtil.js").write_text("", encoding="utf-8")
(org1 / "emptyUtil" / "emptyUtil.html").write_text("<template></template>\n", encoding="utf-8")
(org1 / "emptyUtil" / "emptyUtil.js-meta.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    "    <apiVersion>59.0</apiVersion>\n"
    "    <isExposed>false</isExposed>\n"
    "</LightningComponentBundle>\n",
    encoding="utf-8",
)

# --- ORG 2 ---
org2 = base / "sample_lwc_org2"
org2.mkdir(exist_ok=True)

# Identical (same content as org1)
bundle(
    org2, "accountCard",
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
    org2, "contactList",
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
    org2, "dashboardTile",
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
    org2, "productPicker",
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
(org2 / "emptyUtil").mkdir(exist_ok=True)
(org2 / "emptyUtil" / "emptyUtil.js").write_text("", encoding="utf-8")
(org2 / "emptyUtil" / "emptyUtil.html").write_text("<template></template>\n", encoding="utf-8")
(org2 / "emptyUtil" / "emptyUtil.js-meta.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n'
    "    <apiVersion>59.0</apiVersion>\n"
    "    <isExposed>false</isExposed>\n"
    "</LightningComponentBundle>\n",
    encoding="utf-8",
)

print("Sample LWC orgs created!")
for p in sorted(org1.rglob("*")):
    if p.is_file():
        print("  org1:", p.relative_to(base))
for p in sorted(org2.rglob("*")):
    if p.is_file():
        print("  org2:", p.relative_to(base))

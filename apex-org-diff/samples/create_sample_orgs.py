"""Create sample org folders for testing."""
import pathlib

base = pathlib.Path(__file__).parent

# --- ORG 1 ---
org1 = base / "sample_org1"
org1.mkdir(exist_ok=True)

(org1 / "AccountController.cls").write_text(
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

(org1 / "AccountService.cls").write_text(
    "public class AccountService {\n"
    "    // Shared service - identical in both orgs\n"
    "    public static Account getById(Id accountId) {\n"
    "        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(org1 / "ContactController.cls").write_text(
    "public class ContactController {\n"
    "    public static List<Contact> getContacts(Id accountId) {\n"
    "        return [SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(org1 / "Utility.cls").write_text(
    "public class Utility {\n"
    "    // Only exists in Org A\n"
    "    public static String formatDate(Date d) {\n"
    "        return String.valueOf(d);\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

# Nested folder test
nested = org1 / "triggers"
nested.mkdir(exist_ok=True)
(nested / "AccountTrigger.cls").write_text(
    "public class AccountTrigger {\n"
    "    public static void beforeInsert(List<Account> newAccounts) {}\n"
    "}\n",
    encoding="utf-8",
)

# Empty file test
(org1 / "EmptyClass.cls").write_text("", encoding="utf-8")

# --- ORG 2 ---
org2 = base / "sample_org2"
org2.mkdir(exist_ok=True)

(org2 / "AccountController.cls").write_text(
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

(org2 / "AccountService.cls").write_text(
    "public class AccountService {\n"
    "    // Shared service - identical in both orgs\n"
    "    public static Account getById(Id accountId) {\n"
    "        return [SELECT Id, Name, Phone FROM Account WHERE Id = :accountId];\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(org2 / "ContactController.cls").write_text(
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

(org2 / "NewClass.cls").write_text(
    "public class NewClass {\n"
    "    // Only exists in Org B - new feature\n"
    "    public static void newFeature() {\n"
    "        System.debug('New feature only in sandbox');\n"
    "    }\n"
    "}\n",
    encoding="utf-8",
)

(org2 / "EmptyClass.cls").write_text("", encoding="utf-8")

print("Sample orgs created!")
for p in org1.rglob("*.cls"):
    print("  org1:", p)
for p in org2.rglob("*.cls"):
    print("  org2:", p)

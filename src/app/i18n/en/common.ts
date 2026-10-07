// Czech source string → English. See src/app/i18n/i18n.ts.
export const EN_COMMON: Record<string, string> = {
  // ===== app.config.ts: flagMessages =====
  'Výřezy se překrývají': 'Crops overlap',
  'Chybějící výřez': 'Missing crop',
  'Neúspěšná predikce': 'Prediction failed',
  'Nejistota': 'Low confidence',
  'Podezřelý rozměr': 'Unusual dimensions',
  'Špatné rozdělení dvojstrany': 'Bad spread split',

  // flagHints
  'Dva výřezy se překrývají. Zkontrolujte jejich hranice.': 'Two crops overlap. Check their edges.',
  'Nalezeno méně výřezů, než má sken obvykle mít.': 'Fewer crops found than this scan usually has.',
  'Model na skenu nenašel žádnou stranu.': 'The model found no page on this scan.',
  'Model si detekcí není jistý. Zkontrolujte okraje výřezu.': 'The model is unsure of the detection. Check the crop edges.',
  'Výřez má jiný poměr stran než ostatní strany titulu.': 'The crop has a different aspect ratio than the other pages of the title.',
  'Střed dvoustrany nesedí na hřbet. Zkontrolujte rozdělení.': 'The spread center doesn\'t match the spine. Check the split.',

  // flagActionHints (shown after "·" following the flag label, lowercase fragment)
  'přidejte ho tlačítkem výše': 'add it with the button above',
  'přidejte výřez ručně': 'add a crop manually',

  // gridModeDict
  'Při otáčení': 'While rotating',
  'Vždy': 'Always',
  'Nikdy': 'Never',

  // gridDensityDict keys
  'Řídká': 'Sparse',
  'Běžná': 'Normal',
  'Hustá': 'Dense',
  'Velmi hustá': 'Very dense',

  // cropColorDict keys (+ dimColorDict 'Černá', 'Bílá')
  'Tyrkysová': 'Turquoise',
  'Korálová': 'Coral',
  'Bílá': 'White',
  'Černá': 'Black',

  // gridLineWidthDict keys
  'Tenká': 'Thin',
  'Střední': 'Medium',
  'Silná': 'Thick',
  'Výrazná': 'Bold',

  // outlineWidthDict keys ('Střední' above)
  'Silný': 'Thick',
  'Tenký': 'Thin',
  'Žádný': 'None',

  // dimColorDict keys
  'Tmavě modrá': 'Dark blue',
  'Žádná': 'None',

  // filterScanTypeStartDict
  'Vše': 'All',
  'Podezřelé': 'Flagged',
  'Upravené': 'Edited',
  'OK': 'OK',

  // filterPageNumberStartDict
  'Jednostrany': 'Single pages',
  'Dvoustrany': 'Spreads',

  // defaultFitModeDict
  'Celý sken': 'Whole scan',
  'Výřezy': 'Crops',

  // userRolesDict
  'Admin': 'Admin',
  'Uživatel': 'User',

  // permissionDict
  'Zobrazení všech titulů': 'View all titles',
  'Detail titulu': 'Title detail',
  'Úpravy': 'Edit',
  'Správa': 'Manage',

  // titleStateDict
  'Založena': 'Created',
  'Bude se zpracovávat': 'Scheduled',
  'Zpracovává se': 'Processing',
  'Chyba': 'Error',
  'Nové': 'New',
  'Uloženo': 'Saved',
  'Přetrénování': 'Retraining',
  'Dokončeno': 'Completed',

  // titleStateFilterDict keys (others above)
  'Skeny nenahrány': 'Scans not uploaded',

  // inlineErrors
  'Zadejte název skupiny.': 'Enter a group name.',
  'Skupina s daným názvem už existuje. Zadejte prosím jiný název.': 'A group with this name already exists. Enter a different name.',
  'Zadejte název titulu.': 'Enter a title name.',
  'Nahrajte skeny.': 'Upload scans.',
  'Zadejte jméno uživatele.': 'Enter the user\'s name.',
  'Zadejte e-mail uživatele.': 'Enter the user\'s e-mail.',
  'Zadejte e-mail uživatele ve formátu uzivatel@domena.cz.': 'Enter the user\'s e-mail in the format user@domain.com.',
  'Uživatel s daným e-mailem už existuje. Zadejte prosím jiný e-mail.': 'A user with this e-mail already exists. Enter a different e-mail.',
  'Vyberte skupinu.': 'Select a group.',
  'Vyberte práva ve skupině.': 'Select the group permissions.',
  'Vyberte uživatele.': 'Select a user.',
  'Vyberte práva člena.': 'Select the member\'s permissions.',

  // ===== app.routes.ts: page titles =====
  'Přihlášení | CROPILOT': 'Sign in | CROPILOT',
  'Skupiny - Tituly | CROPILOT': 'Groups - Titles | CROPILOT',
  'Skupiny | CROPILOT': 'Groups | CROPILOT',
  'Uživatelé | CROPILOT': 'Users | CROPILOT',
  'Kontrola a úpravy | CROPILOT': 'Review and edit | CROPILOT',
  'Nemáte oprávnění | CROPILOT': 'Access denied | CROPILOT',
  'Stránka nenalezena | CROPILOT': 'Page not found | CROPILOT',

  // ===== utils.ts: relative dates =====
  'dnes': 'today',
  'včera': 'yesterday',
  'před {n} dnem': '{n} day ago',
  'před {n} dny': '{n} days ago',
  'před měsícem': 'a month ago',
  'před {n} měsíci': '{n} months ago',
  'před rokem': 'a year ago',
  'před {n} lety': '{n} years ago',

  // ===== th-tooltip directive =====
  'Řazení od nejstarších': 'Oldest first',
  'Řazení od nejnovějších': 'Newest first',
  'Žádné řazení': 'No sorting',
  'Řazení Z-A': 'Sorted Z-A',
  'Řazení A-Z': 'Sorted A-Z',

  // ===== charts =====
  'Žádná data': 'No data',
  '{n} hodnota': '{n} value',
  '{n} hodnoty': '{n} values',
  '{n} hodnot': '{n} values',

  // ===== select / toast =====
  'Nenalezeny žádné položky': 'No items found',
  'Zavřít oznámení': 'Close notification',

  // ===== menu =====
  'Nastavení': 'Settings',
  'Klávesové zkratky': 'Keyboard shortcuts',
  'Reset změn v dokumentu': 'Reset changes in document',

  // ===== upload =====
  'Přetáhněte sem': 'Drag files here',
  'Vybrat soubory': 'Choose files',
  'Tyto skeny nejsou ve formátu JPEG nebo PNG:': 'These scans are not JPEG or PNG:',
  'Tyto skeny jsou větší než 4 MB:': 'These scans are larger than 4 MB:',
  '...a {n} další': '...and {n} more',
  '...a {n} dalších': '...and {n} more',

  // ===== login / auth =====
  'Přihlaste se ke svému účtu': 'Sign in to your account',
  'E-MAIL': 'E-MAIL',
  'HESLO': 'PASSWORD',
  'jmeno@knihovna.cz': 'name@library.org',
  'Přihlásit se': 'Sign in',
  'Nesprávný e-mail nebo heslo': 'Incorrect e-mail or password',

  // ===== error pages =====
  'Nemáte oprávnění': 'Access denied',
  'Bohužel nemáte dostatečná oprávnění pro zobrazení této stránky.': 'Unfortunately, you don\'t have permission to view this page.',
  'Zkuste požádat svého admina o udělení přístupu nebo se přihlaste pod jiným účtem.': 'Ask your admin to grant you access, or sign in with a different account.',
  'Přihlásit se pod jiným účtem': 'Sign in with a different account',
  'Upsík dupsík...': 'Oopsie daisy...',
  'Bohužel jsme nenašli stránku, kterou hledáte': 'Sorry, we couldn\'t find the page you\'re looking for',
  'Přejít na domovskou stránku': 'Go to the home page',

  // ===== top panel =====
  'Seznam skupin': 'Group list',
  'Správce skupin': 'Group manager',
  'Správce uživatelů': 'User manager',
  'Statistiky': 'Statistics',

  // ===== statistics service (filter defaults) =====
  'Všechny skupiny': 'All groups',
  'Všechny ořezové modely': 'All crop models',
  'Všechny rotační modely': 'All rotation models',
  'Jazyk': 'Language',
  'Odhlásit se': 'Log out',
};

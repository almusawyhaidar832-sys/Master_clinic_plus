/**
 * Master Clinic Plus — Translation Dictionary
 * Two languages: Arabic (ar) and English (en)
 */

export type Language = "ar" | "en";

export const LANG_LABELS: Record<Language, string> = {
  ar: "العربية",
  en: "English",
};

export type TranslationKey = keyof typeof translations.ar;

const translations = {
  ar: {
    // ── App ──
    appName:            "ماستر كلينك بلس",
    appTagline:         "نظام إدارة العيادات الذكي",

    // ── Navigation ──
    dashboard:          "لوحة التحكم",
    ledger:             "إدخال جلسة",
    queue:              "غرفة الانتظار",
    patients:           "ملفات المرضى",
    reports:            "التقارير",
    doctors:            "الأطباء",
    withdrawals:        "طلبات السحب",
    expenses:           "المصروفات",
    salary:             "رواتب الموظفين",
    inventory:          "المخزون",
    prescriptions:      "الوصفات الذكية",
    whatsapp:           "واتساب",
    settings:           "ملف العيادة",
    wallet:             "المحفظة",
    schedule:           "المواعيد",
    notifications:      "الإشعارات",
    statement:          "كشف حساب",

    // ── Common actions ──
    save:               "حفظ",
    cancel:             "إلغاء",
    delete:             "حذف",
    edit:               "تعديل",
    add:                "إضافة",
    search:             "بحث",
    filter:             "تصفية",
    print:              "طباعة",
    export:             "تصدير",
    confirm:            "تأكيد",
    close:              "إغلاق",
    loading:            "جارٍ التحميل...",
    saving:             "جارٍ الحفظ...",
    refresh:            "تحديث",
    viewAll:            "عرض الكل",
    noData:             "لا توجد بيانات",
    success:            "تم بنجاح",
    error:              "حدث خطأ",

    // ── Auth ──
    login:              "تسجيل الدخول",
    logout:             "تسجيل الخروج",
    username:           "اسم المستخدم",
    password:           "كلمة المرور",
    loginButton:        "دخول",
    loginLoading:       "جارٍ الدخول...",

    // ── Queue ──
    queueTitle:         "غرفة الانتظار",
    addPatient:         "مراجع جديد",
    ticketNumber:       "رقم الدور",
    waitingStatus:      "انتظار",
    calledStatus:       "تم النداء",
    inProgressStatus:   "داخل الكشف",
    doneStatus:         "منتهية",
    cancelledStatus:    "ألغى",
    callNext:           "نداء →",
    enterClinic:        "أدخل الكشف →",
    finishVisit:        "أنهِ الكشف ✓",
    waitingCount:       "في الانتظار",
    tvScreen:           "شاشة المرضى",
    addToQueue:         "إضافة مراجع للطابور",
    selectDoctor:       "الطبيب",
    patientName:        "اسم المراجع",
    patientPhone:       "رقم الهاتف",
    doneToday:          "منتهية اليوم",

    // ── Executive Dashboard ──
    executiveDashboard: "لوحة التحكم التنفيذية",
    netProfit:          "صافي الربح الحقيقي",
    totalRevenue:       "إجمالي الإيرادات",
    collected:          "المتحصل",
    patientDebts:       "ديون المرضى",
    totalExpenses:      "المصروفات",
    treatedPatients:    "المرضى المُعالَجون",
    newPatients:        "مرضى جدد",
    clinicNetShare:     "حصة العيادة الصافية",
    doctorWallets:      "أرباح الأطباء",
    profitBreakdown:    "تحليل صافي الربح",
    smartAlerts:        "تنبيهات ذكية",
    topDoctors:         "أفضل الأطباء",
    topServices:        "أكثر الخدمات مبيعاً",
    today:              "اليوم",
    thisWeek:           "الأسبوع",
    thisMonth:          "هذا الشهر",

    // ── Finance ──
    amount:             "المبلغ",
    currency:           "د.ع",
    paid:               "مدفوع",
    debt:               "متبقي",
    total:              "الإجمالي",
    doctorShare:        "حصة الطبيب",
    clinicShare:        "حصة العيادة",
    materialsCost:      "تكلفة المواد",
    expenseCategory:    "تصنيف المصروف",
    expenseDesc:        "وصف المصروف",
    expenseDate:        "التاريخ",
    newExpense:         "تسجيل مصروف جديد",
    expensesLog:        "سجل المصروفات",

    // ── Patients ──
    fullName:           "الاسم الكامل",
    phone:              "رقم الهاتف",
    gender:             "الجنس",
    male:               "ذكر",
    female:             "أنثى",
    birthDate:          "تاريخ الميلاد",
    notes:              "ملاحظات",
    patientFile:        "ملف المريض",
    patientCode:        "رقم الملف",
    operations:         "العمليات",
    treatments:         "العلاجات",

    // ── Settings ──
    clinicProfile:      "ملف العيادة",
    clinicName:         "اسم العيادة",
    clinicPhone:        "هاتف العيادة",
    clinicAddress:      "العنوان",
    clinicLogo:         "شعار العيادة",
    specialty:          "التخصص",
    language:           "اللغة",
    theme:              "المظهر",
    lightMode:          "فاتح",
    darkMode:           "داكن",

    // ── Doctor Wallet ──
    totalEarnings:      "إجمالي الأرباح",
    totalWithdrawn:     "المسحوب",
    availableBalance:   "الرصيد المتاح",
    pendingAmount:      "قيد المراجعة",
    requestWithdrawal:  "طلب سحب",
    withdrawalHistory:  "سجل السحوبات",

    // ── Roles ──
    roleAccountant:     "محاسب",
    roleDoctor:         "طبيب",
    roleSuperAdmin:     "مالك",
  },

  en: {
    // ── App ──
    appName:            "Master Clinic Plus",
    appTagline:         "Smart Clinic Management System",

    // ── Navigation ──
    dashboard:          "Dashboard",
    ledger:             "Add Session",
    queue:              "Waiting Room",
    patients:           "Patient Files",
    reports:            "Reports",
    doctors:            "Doctors",
    withdrawals:        "Withdrawal Requests",
    expenses:           "Expenses",
    salary:             "Staff Salaries",
    inventory:          "Inventory",
    prescriptions:      "Smart Prescriptions",
    whatsapp:           "WhatsApp",
    settings:           "Clinic Profile",
    wallet:             "Wallet",
    schedule:           "Appointments",
    notifications:      "Notifications",
    statement:          "Account Statement",

    // ── Common actions ──
    save:               "Save",
    cancel:             "Cancel",
    delete:             "Delete",
    edit:               "Edit",
    add:                "Add",
    search:             "Search",
    filter:             "Filter",
    print:              "Print",
    export:             "Export",
    confirm:            "Confirm",
    close:              "Close",
    loading:            "Loading...",
    saving:             "Saving...",
    refresh:            "Refresh",
    viewAll:            "View All",
    noData:             "No data available",
    success:            "Done successfully",
    error:              "An error occurred",

    // ── Auth ──
    login:              "Login",
    logout:             "Logout",
    username:           "Username",
    password:           "Password",
    loginButton:        "Sign In",
    loginLoading:       "Signing in...",

    // ── Queue ──
    queueTitle:         "Waiting Room",
    addPatient:         "New Patient",
    ticketNumber:       "Ticket #",
    waitingStatus:      "Waiting",
    calledStatus:       "Called",
    inProgressStatus:   "In Clinic",
    doneStatus:         "Done",
    cancelledStatus:    "Cancelled",
    callNext:           "Call →",
    enterClinic:        "Enter Clinic →",
    finishVisit:        "Finish Visit ✓",
    waitingCount:       "Waiting",
    tvScreen:           "Patient Screen",
    addToQueue:         "Add Patient to Queue",
    selectDoctor:       "Doctor",
    patientName:        "Patient Name",
    patientPhone:       "Phone Number",
    doneToday:          "Done Today",

    // ── Executive Dashboard ──
    executiveDashboard: "Executive Dashboard",
    netProfit:          "Net Profit",
    totalRevenue:       "Total Revenue",
    collected:          "Collected",
    patientDebts:       "Patient Debts",
    totalExpenses:      "Total Expenses",
    treatedPatients:    "Treated Patients",
    newPatients:        "New Patients",
    clinicNetShare:     "Clinic Net Share",
    doctorWallets:      "Doctor Earnings",
    profitBreakdown:    "Profit Breakdown",
    smartAlerts:        "Smart Alerts",
    topDoctors:         "Top Doctors",
    topServices:        "Best Selling Services",
    today:              "Today",
    thisWeek:           "This Week",
    thisMonth:          "This Month",

    // ── Finance ──
    amount:             "Amount",
    currency:           "IQD",
    paid:               "Paid",
    debt:               "Remaining",
    total:              "Total",
    doctorShare:        "Doctor Share",
    clinicShare:        "Clinic Share",
    materialsCost:      "Materials Cost",
    expenseCategory:    "Category",
    expenseDesc:        "Description",
    expenseDate:        "Date",
    newExpense:         "Add New Expense",
    expensesLog:        "Expenses Log",

    // ── Patients ──
    fullName:           "Full Name",
    phone:              "Phone",
    gender:             "Gender",
    male:               "Male",
    female:             "Female",
    birthDate:          "Date of Birth",
    notes:              "Notes",
    patientFile:        "Patient File",
    patientCode:        "File No.",
    operations:         "Operations",
    treatments:         "Treatments",

    // ── Settings ──
    clinicProfile:      "Clinic Profile",
    clinicName:         "Clinic Name",
    clinicPhone:        "Clinic Phone",
    clinicAddress:      "Address",
    clinicLogo:         "Clinic Logo",
    specialty:          "Specialty",
    language:           "Language",
    theme:              "Theme",
    lightMode:          "Light",
    darkMode:           "Dark",

    // ── Doctor Wallet ──
    totalEarnings:      "Total Earnings",
    totalWithdrawn:     "Withdrawn",
    availableBalance:   "Available Balance",
    pendingAmount:      "Pending",
    requestWithdrawal:  "Request Withdrawal",
    withdrawalHistory:  "Withdrawal History",

    // ── Roles ──
    roleAccountant:     "Accountant",
    roleDoctor:         "Doctor",
    roleSuperAdmin:     "Owner",
  },
} as const;

export { translations };
export type Translations = typeof translations.ar;

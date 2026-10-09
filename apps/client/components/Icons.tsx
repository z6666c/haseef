/**
 * منظومة أيقونات حصيف (دليل الهوية §4): Duo-tone / Micro-stroke،
 * سُمك الخط 1.75px، حواف مستديرة، ولمسة زمردية واحدة في كل أيقونة.
 * الخطوط الأساسية بلون النص الحالي (currentColor) لتعمل على الخلفيات الفاتحة والداكنة.
 */

type P = { size?: number; title?: string };

function Svg({ size = 20, title, children }: P & { children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
         strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined}
         aria-hidden={title ? undefined : true} aria-label={title}>
      {children}
    </svg>
  );
}

const A = "var(--emerald)"; // اللمسة الزمردية

/** مؤشر حصافة — Shield-Check */
export const ShieldCheck = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 4.5 5.6V11c0 4.6 3.2 8.4 7.5 9.9 4.3-1.5 7.5-5.3 7.5-9.9V5.6Z" />
    <path d="m8.8 12 2.3 2.3 4.4-4.6" stroke={A} />
  </Svg>
);

/** الرادار العام — رادار دائري */
export const Radar = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" opacity={0.55} />
    <path d="M12 12 18 6" stroke={A} />
    <circle cx="15.6" cy="8.4" r="1.1" fill={A} stroke="none" />
  </Svg>
);

/** التراخيص والبلدية — Building-Badge */
export const BuildingBadge = (p: P) => (
  <Svg {...p}>
    <path d="M4 20.5V6.5L11 3.5v17" />
    <path d="M11 9.5h5.5v4" />
    <path d="M7 8.5h1M7 12h1M7 15.5h1" />
    <path d="M3 20.5h9" />
    <circle cx="17.5" cy="17.5" r="3.2" stroke={A} />
    <path d="m16.2 17.5 1 1 1.6-1.7" stroke={A} />
  </Svg>
);

/** عقود العمل وقوى — Users-Contract */
export const UsersContract = (p: P) => (
  <Svg {...p}>
    <circle cx="6.5" cy="7" r="2.3" />
    <circle cx="17.5" cy="7" r="2.3" />
    <path d="M2.8 16c.5-2.4 2-3.8 3.7-3.8M21.2 16c-.5-2.4-2-3.8-3.7-3.8" />
    <rect x="8.5" y="11" width="7" height="9" rx="1.2" />
    <path d="M10.5 14h3M10.5 16.5h1.5" />
    <circle cx="14" cy="18" r=".9" fill={A} stroke="none" />
  </Svg>
);

/** مجلس الشركاء والحوكمة — Gavel-Document */
export const GavelDocument = (p: P) => (
  <Svg {...p}>
    <path d="M14 21H6.5A1.5 1.5 0 0 1 5 19.5v-14A1.5 1.5 0 0 1 6.5 4H13l4 4v3" />
    <path d="M8 9h4M8 12h5M8 15h3" />
    <path d="m15 15.5 3-3M16.8 11.7l2.5 2.5M14.2 14.3l2.5 2.5M17.8 15.6l3.2 3.2" stroke={A} />
  </Svg>
);

/** نظام PDPL — Fingerprint-Shield */
export const FingerprintShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 4.5 5.6V11c0 4.6 3.2 8.4 7.5 9.9 4.3-1.5 7.5-5.3 7.5-9.9V5.6Z" />
    <path d="M9.2 14.5c-.3-.7-.4-1.4-.4-2.2a3.2 3.2 0 0 1 6.4 0c0 1.5-.2 2.6-.7 3.6" stroke={A} />
    <path d="M12 12.2c0 1.6-.2 2.8-.8 3.9" stroke={A} />
  </Svg>
);

/** فاحص الذكاء الاصطناعي — File-Sparkle */
export const FileSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M13 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-8" />
    <path d="M8 12h6M8 15h7M8 18h4" />
    <path d="M18 2.5 18.8 4.7 21 5.5 18.8 6.3 18 8.5 17.2 6.3 15 5.5 17.2 4.7Z" stroke={A} fill={A} />
  </Svg>
);

/** تنبيهات الواتساب — Bell-Message */
export const BellMessage = (p: P) => (
  <Svg {...p}>
    <path d="M6 15.5V10a5 5 0 0 1 10 0v5.5l1.5 1.5h-13Z" />
    <path d="M9.5 19.5a1.6 1.6 0 0 0 3 0" />
    <path d="M17 3.5h4a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1h-1.5L18 9.3V8h-1a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke={A} />
  </Svg>
);

/** مصفوفة الصلاحيات — Key-Hierarchy */
export const KeyHierarchy = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2.2" stroke={A} />
    <path d="M12 7.2v3.3M6 13.5v-3h12v3" />
    <circle cx="6" cy="16" r="2.2" />
    <circle cx="18" cy="16" r="2.2" />
    <path d="M6 18.2V21M18 18.2V21M5 20h1M17 20h1" />
  </Svg>
);

export const Plus = (p: P) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const WhatsApp = (p: P) => (
  <Svg {...p}>
    <path d="M4 20l1.2-3.6A8 8 0 1 1 8 19Z" />
    <path d="M9.2 9.2c.2 2 1.6 3.9 3.6 4.9l1.1-1.1 1.8.8c-.1 1-1 1.7-2 1.6-3-.4-5.7-3.1-6-6.1-.1-1 .6-1.9 1.6-2l.8 1.8Z" stroke={A} strokeWidth={1.4} />
  </Svg>
);

export const External = (p: P) => (
  <Svg {...p}><path d="M14 5h5v5M19 5l-7 7M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" /></Svg>
);

/** المكتبة المرجعية — كتاب مفتوح */
export const BookOpen = (p: P) => (
  <Svg {...p}>
    <path d="M12 6.5C10.2 5 7.6 4.5 4 4.8v13c3.6-.3 6.2.2 8 1.7 1.8-1.5 4.4-2 8-1.7v-13c-3.6-.3-6.2.2-8 1.7Z" />
    <path d="M12 6.5v13" stroke={A} />
  </Svg>
);

/** الالتزامات — قائمة تحقق */
export const ListCheck = (p: P) => (
  <Svg {...p}>
    <path d="M11 6h9M11 12h9M11 18h9" />
    <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11" stroke={A} />
    <circle cx="5.5" cy="18" r="1.5" />
  </Svg>
);

/** السياسات — وثيقة بختم */
export const DocSeal = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H11" />
    <path d="M14 3v4h4M14 3l4 4v4M8 9h4M8 13h3" />
    <circle cx="16.5" cy="16.5" r="3" stroke={A} />
    <path d="m15.2 19.2-.7 2.3 2-1 2 1-.7-2.3" stroke={A} />
  </Svg>
);

/** الاستشارات القانونية — ميزان */
export const Scales = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v16M8 20h8M5 7h14" />
    <path d="M12 4.5 7 7M12 4.5 17 7" />
    <path d="m5 7-2.5 6a3 3 0 0 0 5 0Z" stroke={A} />
    <path d="m19 7-2.5 6a3 3 0 0 0 5 0Z" stroke={A} />
  </Svg>
);

/** المجموعة والمنشآت — مبنى رئيسي ومنشأتان تابعتان */
export const BuildingsGroup = (p: P) => (
  <Svg {...p}>
    <path d="M9 20.5V5.5L13.5 3.5v17" />
    <path d="M11.2 8h.1M11.2 11.5h.1M11.2 15h.1" />
    <path d="M3 20.5v-8h6M15 20.5v-6h6v6" stroke={A} />
    <path d="M2 20.5h20" />
  </Svg>
);

/** تقرير المجلس — وثيقة بمخطط أعمدة */
export const ReportChart = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 17.5v-3M12 17.5v-5M15 17.5v-2" stroke={A} />
  </Svg>
);

/** الاشتراك والدفعات — بطاقة دفع */
export const CardReceipt = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3 9.5h18" />
    <path d="M6.5 15h4" stroke={A} />
  </Svg>
);

/** الزكاة والضريبة — إيصال بنسبة مئوية */
export const ReceiptPercent = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5L8.4 20.5 6 19Z" />
    <path d="m9.2 14.8 5.6-5.6" stroke={A} />
    <circle cx="9.6" cy="9.6" r="1" fill={A} stroke="none" />
    <circle cx="14.4" cy="14.4" r="1" fill={A} stroke="none" />
  </Svg>
);

/** بوت الموظفين — فقاعة محادثة */
export const ChatBot = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4 3.5v-3.5h-.5a2 2 0 0 1-2-2Z" />
    <circle cx="9.5" cy="10.5" r="1" fill={A} stroke="none" />
    <circle cx="14.5" cy="10.5" r="1" fill={A} stroke="none" />
  </Svg>
);

export const MapPinCheck = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <path d="m9.5 10 1.8 1.8 3.4-3.6" stroke={A} />
  </Svg>
);

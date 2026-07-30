/* 功能性图标集 —— 线性、16px 网格、currentColor 继承 */
const I = ({ d, children, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
);

const IcToday = (p) => (
  <I {...p}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 4.5V2.5M16 4.5V2.5" /><circle cx="12" cy="14.5" r="2" /></I>
);
const IcCreate = (p) => (
  <I {...p} d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9L12 3.5zM18 16.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
);
const IcCalendar = (p) => (
  <I {...p}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 4.5V2.5M16 4.5V2.5M7.5 13h3M13.5 13h3M7.5 17h3" /></I>
);
const IcLibrary = (p) => (
  <I {...p}><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></I>
);
const IcIntel = (p) => (
  <I {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5M11 8v6M8 11h6" /></I>
);
const IcRacing = (p) => (
  <I {...p} d="M4 20V13M9.5 20V8M15 20v-6M20.5 20V4" />
);
const IcBrand = (p) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /></I>
);
const IcMap = (p) => (
  <I {...p}><rect x="3" y="3.5" width="7" height="6" rx="1.5" /><rect x="14" y="3.5" width="7" height="6" rx="1.5" /><rect x="8.5" y="14.5" width="7" height="6" rx="1.5" /><path d="M6.5 9.5v2.5h11V9.5M12 12v2.5" /></I>
);
const IcArrow = (p) => <I {...p} d="M5 12h13M13 7l5 5-5 5" />;
const IcCheck = (p) => <I {...p} d="M4.5 12.5l4.5 4.5L19.5 6.5" />;
const IcWand = (p) => <I {...p} d="M4 20L15 9M17.5 3v3M17.5 9.5v3M13.5 6.5h3M19.5 6.5h3M8 4l.8 1.9L10.7 6.7 8.8 7.5 8 9.4 7.2 7.5 5.3 6.7 7.2 5.9 8 4z" />;
const IcVideo = (p) => (
  <I {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-2.5v8l-5-2.5z" /></I>
);
const IcImage = (p) => (
  <I {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M3 16l4.5-4 4 3.5L15 12l6 5" /></I>
);
const IcCarousel = (p) => (
  <I {...p}><rect x="6.5" y="5" width="11" height="14" rx="1.8" /><path d="M3.5 8v8M20.5 8v8" /></I>
);
const IcText = (p) => <I {...p} d="M5 6h14M5 11h14M5 16h9" />;
const IcClock = (p) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>;
const IcAlert = (p) => <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16h.01" /></I>;
const IcSpark = (p) => <I {...p} d="M13 3l-2 7H5l6 11 2-7h6L13 3z" />;

Object.assign(window, {
  IcToday, IcCreate, IcCalendar, IcLibrary, IcIntel, IcRacing, IcBrand, IcMap,
  IcArrow, IcCheck, IcWand, IcVideo, IcImage, IcCarousel, IcText, IcClock,
  IcAlert, IcSpark,
});

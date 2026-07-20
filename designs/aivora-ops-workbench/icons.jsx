// 细线图标集（16px stroke）
const AvIcon = ({ d, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" {...props}>
    {d}
  </svg>
);
const IconHome = (p) => <AvIcon {...p} d={<><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></>} />;
const IconClap = (p) => <AvIcon {...p} d={<><rect x="3" y="9" width="18" height="11" rx="2"/><path d="m3.5 9 2-4.5 4 1-2 4.5m2-4 4 1-2 4.5m2-4 4 1L19 12"/></>} />;
const IconGrid = (p) => <AvIcon {...p} d={<><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>} />;
const IconLock = (p) => <AvIcon {...p} d={<><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>} />;
const IconPlus = (p) => <AvIcon {...p} d={<path d="M12 5v14M5 12h14"/>} />;
const IconCheck = (p) => <AvIcon {...p} d={<path d="m5 12.5 4.5 4.5L19 7"/>} />;
Object.assign(window, { AvIcon, IconHome, IconClap, IconGrid, IconLock, IconPlus, IconCheck });

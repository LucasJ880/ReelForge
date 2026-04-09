export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#08080c] overflow-hidden">
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-violet-600/15 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] left-[20%] w-[300px] h-[300px] rounded-full bg-fuchsia-500/10 blur-[100px] pointer-events-none" />
      {children}
    </div>
  );
}

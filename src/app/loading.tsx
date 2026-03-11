export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-[28px] border border-white/70 bg-white/90 px-8 py-12 text-center shadow-[0_24px_80px_rgba(43,37,20,0.12)] backdrop-blur">
        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Nashville Build Insider</div>
        <h1 className="mt-4 font-display text-4xl text-stone-950">Scanning Nashville commercial activity</h1>
        <div className="mx-auto mt-8 h-1.5 w-28 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full w-1/2 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-amber-500" />
        </div>
      </div>
    </main>
  );
}

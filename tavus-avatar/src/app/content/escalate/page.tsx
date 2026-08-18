export default function EscalatePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(180deg,_#f6fbff_0%,_#e7f1fb_100%)] px-8 py-10 text-center text-slate-950">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-[2rem] border border-sky-200/80 bg-white/85 p-10 shadow-[0_24px_90px_rgba(7,15,43,0.12)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-700">
          One Moment
        </p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-950">
          Connecting you with a team member
        </h1>
        <p className="max-w-sm text-base leading-7 text-slate-600">
          Someone from our team will be with you shortly to go over this.
        </p>
        <p className="mt-2 inline-flex w-fit rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
          Placeholder — no live hand-off wired up yet
        </p>
      </div>
    </main>
  );
}

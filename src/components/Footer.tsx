export function Footer({ text }: { text: string }) {
  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 py-2 px-3 text-center text-[10px] tracking-widest text-foreground/70 bg-background/80 backdrop-blur border-t border-border">
      {text}
    </footer>
  );
}

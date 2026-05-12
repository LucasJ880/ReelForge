import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";

export default function CreateVideoPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Make a video</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Describe what you want. Add a photo if you like. Pick duration. Generate.
        </p>
      </header>
      <UnifiedCreativeInputShell userType="personal" />
    </div>
  );
}

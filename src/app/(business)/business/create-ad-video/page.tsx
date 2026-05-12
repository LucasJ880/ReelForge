import { UnifiedCreativeInputShell } from "@/components/video-generation/unified-creative-input-shell";

export default function CreateAdVideoPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Create ad video</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Describe the video, attach product images or footage, pick a duration. Aivora handles the rest.
        </p>
      </header>
      <UnifiedCreativeInputShell userType="business" />
    </div>
  );
}

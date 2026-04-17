export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto prose prose-zinc prose-sm">
      <h1 className="text-lg font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-xs text-zinc-400 mb-6">Last updated: April 14, 2026</p>

      <p className="font-medium">
        This Privacy Policy applies to our website Aivora (https://reelforge-delta.vercel.app)
        and describes how we collect, use, and protect your information when you use our service.
      </p>

      <h2>1. Information We Collect</h2>
      <p>When you use Aivora, we may collect the following information:</p>
      <ul>
        <li><strong>Account Data:</strong> Email address and name you provide during registration.</li>
        <li><strong>Content Data:</strong> Keywords and product images you input, and AI-generated content (scripts, captions, video prompts, videos) are stored to provide the Service.</li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <p>We use collected information solely to:</p>
      <ul>
        <li>Generate AI content and videos based on your input</li>
        <li>Store your generated assets so you can revisit and download them</li>
        <li>Improve Aivora and its features</li>
      </ul>

      <h2>3. Data Sharing</h2>
      <p>
        We do not sell your personal information. We share data only with the third-party services
        necessary to provide Aivora (OpenAI for content generation, video generation providers, and Vercel Blob for media storage).
      </p>

      <h2>4. Data Storage and Security</h2>
      <p>
        Your data is stored securely using industry-standard practices. Media assets are stored in
        encrypted cloud storage. We never store your payment credentials directly.
      </p>

      <h2>5. Your Rights</h2>
      <p>You can:</p>
      <ul>
        <li>Delete your projects and associated media at any time from the application</li>
        <li>Request deletion of your account and all associated data by contacting us</li>
      </ul>

      <h2>6. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of any material changes
        by updating the date at the top of this page.
      </p>

      <h2>7. Contact</h2>
      <p>
        For privacy-related questions or data deletion requests, please contact us at support@aivora.app
        or through the Aivora platform.
      </p>
    </div>
  );
}

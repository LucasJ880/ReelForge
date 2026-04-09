export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto prose prose-zinc prose-sm">
      <h1 className="text-lg font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-xs text-zinc-400 mb-6">Last updated: April 9, 2026</p>

      <p className="font-medium">
        This Privacy Policy applies to our website Aivora (https://reelforge-delta.vercel.app)
        and describes how we collect, use, and protect your information when you use our service.
      </p>

      <h2>1. Information We Collect</h2>
      <p>When you use Aivora, we may collect the following information:</p>
      <ul>
        <li><strong>Account Data:</strong> Email address and name you provide during registration.</li>
        <li><strong>TikTok Account Data:</strong> When you connect your TikTok account, we receive your open ID, display name, and avatar through TikTok&apos;s OAuth process. We store access tokens and refresh tokens to maintain your connection.</li>
        <li><strong>Content Data:</strong> Keywords you input and AI-generated content (scripts, captions, video prompts) are stored to provide the Service.</li>
        <li><strong>Video Performance Data:</strong> We fetch publicly available video metrics (views, likes, comments, shares) from TikTok for videos published through Aivora.</li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <p>We use collected information solely to:</p>
      <ul>
        <li>Generate AI content based on your input</li>
        <li>Publish videos to your connected TikTok account on your behalf</li>
        <li>Retrieve and display video performance analytics</li>
        <li>Improve Aivora and its features</li>
      </ul>

      <h2>3. Data Sharing</h2>
      <p>
        We do not sell your personal information. We share data only with the third-party services
        necessary to provide Aivora (OpenAI for content generation, TikTok for publishing and analytics,
        video generation providers).
      </p>

      <h2>4. Data Storage and Security</h2>
      <p>
        Your data is stored securely using industry-standard practices. Access tokens are stored in our
        database and are used only for authorized API calls on your behalf.
      </p>

      <h2>5. Your Rights</h2>
      <p>You can:</p>
      <ul>
        <li>Disconnect your TikTok account at any time through the Settings page</li>
        <li>Delete your projects and associated data</li>
        <li>Request deletion of your account and all associated data by contacting us</li>
      </ul>

      <h2>6. TikTok Data</h2>
      <p>
        Our use of TikTok data is limited to the scopes you authorize (basic user info, video publishing,
        video listing). We access your TikTok data only when you explicitly trigger actions through Aivora
        (publishing a video, fetching analytics). We do not access your TikTok data for any other purpose.
      </p>

      <h2>7. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of any material changes
        by updating the date at the top of this page.
      </p>

      <h2>8. Contact</h2>
      <p>
        For privacy-related questions or data deletion requests, please contact us at support@aivora.app
        or through the Aivora platform.
      </p>
    </div>
  );
}

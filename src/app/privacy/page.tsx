export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: March 28, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Information We Collect</h2>
            <p>When you use Video Poster, we collect the following information:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account credentials:</strong> Username and encrypted password for Service login</li>
              <li><strong>Social media tokens:</strong> OAuth access tokens and refresh tokens for connected platforms (YouTube, TikTok)</li>
              <li><strong>Uploaded content:</strong> Video files and associated metadata (captions, hashtags) temporarily stored for processing</li>
              <li><strong>Usage logs:</strong> Job processing logs, error reports, and scheduling data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. How We Use Your Information</h2>
            <p>We use collected information solely to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Authenticate your access to the Service</li>
              <li>Publish video content to your connected social media accounts on your behalf</li>
              <li>Schedule and manage your content queue</li>
              <li>Troubleshoot errors and improve Service reliability</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. Third-Party Platform Data</h2>
            <p>
              When you connect a social media account (YouTube, TikTok, or Instagram), we receive
              authentication tokens from these platforms. We use these tokens exclusively to publish
              content you have authorized. We do not access your private messages, follower lists,
              or other personal data from these platforms beyond what is necessary for video publishing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. Data Storage and Security</h2>
            <p>
              Your data is stored on secure servers hosted by Railway. OAuth tokens are stored in an
              encrypted database. Video files are temporarily stored for processing and can be
              automatically deleted after successful publishing based on your settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. Data Sharing</h2>
            <p>
              We do not sell, rent, or share your personal information with third parties. Your content
              is only sent to the social media platforms you have explicitly connected and authorized.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Data Retention</h2>
            <p>
              Video files may be deleted after successful publishing if auto-delete is enabled in your
              settings. Account data and logs are retained as long as your account is active. You may
              request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Disconnect your social media accounts at any time</li>
              <li>Request deletion of your data</li>
              <li>Revoke third-party platform access through the respective platform&apos;s settings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">8. Cookies</h2>
            <p>
              The Service uses a session cookie (admin_token) for authentication purposes only. No
              tracking cookies or third-party analytics are used.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this page
              with an updated revision date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">10. Contact</h2>
            <p>
              For privacy-related questions or data requests, please contact us at privacy@videoposter.app.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: March 28, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Acceptance of Terms</h2>
            <p>
              By accessing and using Video Poster (&quot;the Service&quot;), you agree to be bound by these
              Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. Description of Service</h2>
            <p>
              Video Poster is a social media management tool that allows users to upload and publish
              video content to multiple social media platforms including YouTube, TikTok, and Instagram
              from a single dashboard. The Service acts as an intermediary to schedule and post content
              on behalf of the user.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for
              all activities that occur under your account. You agree to notify us immediately of any
              unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. Third-Party Platform Access</h2>
            <p>
              The Service connects to third-party platforms (YouTube, TikTok, Instagram) using OAuth
              authentication. By connecting your social media accounts, you authorize the Service to
              publish content on your behalf. You may revoke this access at any time through the
              respective platform&apos;s settings or through the Service&apos;s account management page.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. User Content</h2>
            <p>
              You retain ownership of all content you upload through the Service. You are solely
              responsible for ensuring that your content complies with the terms of service of each
              platform to which it is published. The Service does not claim any ownership over your content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Prohibited Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Upload or distribute content that is illegal, harmful, or violates third-party rights</li>
              <li>Spam or engage in bulk unauthorized posting</li>
              <li>Attempt to circumvent platform rate limits or restrictions</li>
              <li>Interfere with the Service&apos;s operations or security</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">7. Limitation of Liability</h2>
            <p>
              The Service is provided &quot;as is&quot; without warranties of any kind. We are not liable for any
              damages arising from the use or inability to use the Service, including but not limited to
              failed uploads, account suspensions by third-party platforms, or data loss.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">8. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the Service after
              changes constitutes acceptance of the modified terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">9. Contact</h2>
            <p>
              For questions about these Terms, please contact us at support@videoposter.app.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

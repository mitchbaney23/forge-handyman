import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy — Forge Handyman Service",
  description:
    "How Forge Handyman Service collects, uses, and protects your personal information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalLayout eyebrow="Legal" title="Privacy Policy" lastUpdated="May 2026">
      <p>
        Forge Handyman Service (&ldquo;Forge,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;) is a family-run home-services business in Garner, North
        Carolina. This policy explains what information we collect when you
        contact us or hire us, why we collect it, how long we keep it, and the
        choices you have. We keep it plain-English on purpose.
      </p>

      <h2>What we collect</h2>
      <p>When you submit our contact form or become a customer, we may collect:</p>
      <ul>
        <li>Your name, phone number, and email address</li>
        <li>Your property address and property type</li>
        <li>Details about the work you&rsquo;re requesting, including any photos you choose to upload</li>
        <li>Your preferred timing and how you&rsquo;d like us to reach you</li>
        <li>How you heard about us (if you tell us)</li>
        <li>
          Payment information when you pay a deposit or balance. Card details are
          entered directly with our payment processor (Stripe) and are{" "}
          <strong>never stored on our systems</strong> &mdash; we only keep a
          token that lets us charge the agreed amount.
        </li>
      </ul>

      <h2>Why we collect it</h2>
      <ul>
        <li>To respond to your request and give you an estimate</li>
        <li>To schedule, perform, and follow up on the work</li>
        <li>To process deposits and final payments</li>
        <li>To send you booking confirmations and, if you&rsquo;re a past customer, occasional follow-ups (which you can opt out of at any time)</li>
        <li>To keep records required for tax and accounting</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        We do not sell your information. We share only what&rsquo;s necessary with
        the service providers that help us run the business:
      </p>
      <ul>
        <li><strong>Google Workspace</strong> &mdash; email, calendar, and our customer records spreadsheet</li>
        <li><strong>Stripe</strong> &mdash; payment processing</li>
        <li><strong>Cloudflare</strong> &mdash; spam/bot protection on our forms</li>
        <li><strong>Vercel, Upstash, and Sentry</strong> &mdash; website hosting, rate-limiting, and error monitoring</li>
        <li><strong>Twilio</strong> &mdash; text-message reminders, once that feature is live and only if you haven&rsquo;t opted out</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep completed-job records for seven years to meet tax record-keeping
        requirements. Requests that don&rsquo;t become jobs (declined or expired
        leads) are kept for about 90 days. Photos are kept on the same schedule
        as the job they belong to. Full detail is in our internal data-retention
        policy.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Opt out of follow-ups:</strong> every automated follow-up email has a one-click unsubscribe link.</li>
        <li><strong>Stop texts:</strong> reply STOP to any text message and we&rsquo;ll stop immediately.</li>
        <li>
          <strong>Request deletion:</strong> email us at{" "}
          <a href={BUSINESS.emailHref}>{BUSINESS.email}</a> and we&rsquo;ll
          remove or anonymize your personal information, except where we&rsquo;re
          legally required to retain records (for example, completed-job records
          for tax purposes, which we anonymize rather than delete).
        </li>
      </ul>

      <h2>How we protect it</h2>
      <p>
        Your data is transmitted over encrypted connections (HTTPS), our admin
        tools require Google sign-in restricted to authorized staff, payment card
        data never touches our servers, and we log access to customer records for
        accountability.
      </p>

      <h2>Children</h2>
      <p>
        Our services are for homeowners and property managers. We don&rsquo;t
        knowingly collect information from anyone under 18.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we change this policy we&rsquo;ll update the date at the top. Material
        changes will be noted on this page.
      </p>

      <h2>Contact us</h2>
      <p>
        Questions about your privacy? Reach us at{" "}
        <a href={BUSINESS.emailHref}>{BUSINESS.email}</a> or{" "}
        <a href={BUSINESS.phoneHref}>{BUSINESS.phone}</a>.
        <br />
        {BUSINESS.name} &middot; {BUSINESS.mailingAddress}
      </p>
    </LegalLayout>
  );
}

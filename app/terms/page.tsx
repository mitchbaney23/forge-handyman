import type { Metadata } from "next";
import { LegalLayout } from "@/components/LegalLayout";
import { BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service — Forge Handyman Service",
  description:
    "The terms that govern estimates, bookings, and payments with Forge Handyman Service.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalLayout eyebrow="Legal" title="Terms of Service" lastUpdated="May 2026">
      <p>
        These terms govern your use of the Forge Handyman Service website and the
        work we perform for you. By submitting our contact form, accepting a
        quote, or hiring us, you agree to these terms. We&rsquo;ve kept them
        straightforward.
      </p>

      <h2>Who we are &amp; where we work</h2>
      <p>
        Forge Handyman Service is a family-run handyman business based in Garner,
        NC, serving Garner, Clayton, and South Raleigh and the surrounding Wake
        and Johnston County area. We may decline or refer out work that falls
        outside our service area or scope.
      </p>

      <h2>Estimates &amp; scope of work</h2>
      <ul>
        <li>Estimates are free and provided in good faith based on the information you give us.</li>
        <li>The final price may change if the actual work differs from what was described, or if hidden conditions are discovered once work begins. We&rsquo;ll talk to you before doing anything that changes the agreed price.</li>
        <li>Work is limited to the tasks described in your quote. Additional work is quoted separately.</li>
      </ul>

      <h2>Payment terms</h2>
      <ul>
        <li>For most jobs we collect a <strong>deposit</strong> when you book, which reserves your date and saves a card on file.</li>
        <li>The <strong>remaining balance</strong> is charged to that same card when the work is completed and you&rsquo;ve had a chance to confirm it&rsquo;s done right.</li>
        <li>Payments are processed securely by Stripe. We do not store your card number.</li>
        <li>If a payment fails, we&rsquo;ll reach out to arrange another method before the balance is considered overdue.</li>
      </ul>

      <h2>Scheduling &amp; cancellation</h2>
      <ul>
        <li>We&rsquo;ll confirm your appointment date after the deposit is received.</li>
        <li>If you need to reschedule or cancel, please give us as much notice as you can. Deposits for cancellations made with reasonable notice are credited toward a future booking; we&rsquo;ll always try to be fair.</li>
        <li>If we ever need to reschedule on our end, you&rsquo;ll hear it directly from us &mdash; not a no-show.</li>
      </ul>

      <h2>Workmanship</h2>
      <p>
        We stand behind our work. If something we did isn&rsquo;t right, tell us
        and we&rsquo;ll make it right. This doesn&rsquo;t cover normal wear and
        tear, issues caused by other parties, or pre-existing conditions outside
        the scope of the work we performed.
      </p>

      <h2>Liability</h2>
      <p>
        Forge is fully insured. To the extent permitted by North Carolina
        law, our liability for any claim related to the work is limited to the
        amount you paid for that work. We are not liable for indirect or
        consequential damages.
      </p>

      <h2>Photos</h2>
      <p>
        Photos you upload are used to understand and perform the work. We may use
        before/after photos of completed work for our portfolio or marketing only
        with your permission, and never in a way that identifies your address.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of North Carolina.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Reach us at{" "}
        <a href={BUSINESS.emailHref}>{BUSINESS.email}</a> or{" "}
        <a href={BUSINESS.phoneHref}>{BUSINESS.phone}</a>.
        <br />
        {BUSINESS.name} &middot; {BUSINESS.mailingAddress}
      </p>
    </LegalLayout>
  );
}

// The words every email uses to ask for a Google review: the review request
// itself (daily cron and the job page's Send review request), the completion
// receipt, and the payment receipt for cash/check/Venmo. Mitch's own message
// (2026-10-19), lightly edited; change it here and every email follows.

export interface ReviewAskCopy {
  // Thanks for the job, named when the email knows it.
  opening: string;
  // The ask itself, just above the review button.
  ask: string;
  // After the button.
  closing: string;
}

export const REVIEW_SIGN_OFF = "— The Forge team";

// serviceRef: "your project in Clayton"; omitted, "this job".
export function reviewAskCopy(serviceRef?: string): ReviewAskCopy {
  const what = serviceRef?.trim() ? serviceRef.trim() : "this job";
  return {
    opening: `Thank you so much for choosing Forge! We're so happy we could help with ${what}.`,
    ask: "We're a growing small business looking to help more people in the Triangle, so we'd really appreciate it if you left us a Google review.",
    closing:
      "Thank you again, and let us know if you ever need anything else, or if there's anything more we could have done on this job. Just reply to this email.",
  };
}

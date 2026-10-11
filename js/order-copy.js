(function () {
  var labels = {
    CREATED: "Waiting for payment",
    PENDING: "Payment processing",
    PAID: "Payment received",
    READY_FOR_PRODUCTION: "Ready to produce",
    FAILED: "Payment failed",
    EXPIRED: "Checkout expired",
    CANCELLED: "Cancelled",
    REFUNDED: "Refunded",
    missing: "Brief needed",
    complete: "Brief received",
    BRIEF_RECEIVED: "Brief received",
    IN_PRODUCTION: "In production",
    REVIEW: "Ready for your review",
    DELIVERED: "Delivered",
    unavailable: "Video not ready",
    ready: "Video ready"
  };
  var steps = [
    { id: "PAID", label: "Paid" },
    { id: "BRIEF_RECEIVED", label: "Brief received" },
    { id: "IN_PRODUCTION", label: "In production" },
    { id: "REVIEW", label: "In review" },
    { id: "DELIVERED", label: "Delivered" }
  ];
  var nextCopy = {
    wait_for_payment: "Finish checkout so we can confirm payment.",
    submit_creative_brief: "Tell us what this ad should say.",
    wait_for_production: "Your brief is in. Production has not started yet.",
    wait_for_review: "Your video is being produced.",
    review_or_request_revision: "Review the video, or request a change if you have revisions left.",
    download_delivery: "Your finished video is ready.",
    wait_for_file: "The video is marked delivered, but the file is not available yet."
  };

  function label(value) {
    return labels[value] || "In progress";
  }

  function nextText(action) {
    return nextCopy[action] || "We'll show the next step here.";
  }

  function stepIndex(order) {
    if (!order) return -1;
    if (order.payment_status !== "PAID" && order.payment_status !== "READY_FOR_PRODUCTION") return -1;
    var status = order.workflow_status;
    if (order.payment_status === "READY_FOR_PRODUCTION" && (!status || status === "PAID")) status = "BRIEF_RECEIVED";
    if (!status) status = "PAID";
    return steps.findIndex(function (step) { return step.id === status; });
  }

  window.EmberOrderCopy = {
    label: label,
    nextText: nextText,
    steps: steps,
    stepIndex: stepIndex
  };
})();

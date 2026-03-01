"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

type WebVitalPayload = {
  type: "web-vital" | "client-error";
  name: string;
  value: number;
  id?: string;
  rating?: string;
  delta?: number;
  path?: string;
};

const sendMetric = (payload: WebVitalPayload) => {
  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/observability/vitals", blob);
    return;
  }

  void fetch("/api/observability/vitals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
};

export default function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric: {
    name: string;
    value: number;
    id: string;
    rating?: string;
    delta?: number;
  }) => {
    if (!metric?.name || typeof metric.value !== "number") return;

    if (metric.name !== "LCP" && metric.name !== "INP" && metric.name !== "CLS") {
      return;
    }

    sendMetric({
      type: "web-vital",
      name: metric.name,
      value: metric.value,
      id: metric.id,
      rating: metric.rating,
      delta: metric.delta,
      path: pathname,
    });
  });

  useEffect(() => {
    const onUnhandledRejection = () => {
      sendMetric({
        type: "client-error",
        name: "unhandledrejection",
        value: 1,
        path: pathname,
      });
    };

    const onError = () => {
      sendMetric({
        type: "client-error",
        name: "error",
        value: 1,
        path: pathname,
      });
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, [pathname]);

  return null;
}

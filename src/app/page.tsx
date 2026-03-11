"use client";

import { useEffect, useState } from "react";
import { Onboarding } from "@/components/Onboarding";
import TheatrePage from "./theatre/page";

const ONBOARDING_KEY = "emergence_onboarded";

export default function Home() {
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    setHasOnboarded(localStorage.getItem(ONBOARDING_KEY) === "true");
  }, []);

  function handleEnter() {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setHasOnboarded(true);
  }

  // SSR / loading state
  if (hasOnboarded === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]" />
    );
  }

  if (!hasOnboarded) {
    return <Onboarding onEnter={handleEnter} />;
  }

  return <TheatrePage />;
}

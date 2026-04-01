"use client";

import dynamic from "next/dynamic";

const BIMViewer = dynamic(() => import("@/components/BIMViewer"), {
  ssr: false,
});

export default function Home() {
  return <BIMViewer />;
}

import { Suspense } from "react";
import { AssistantQueuePanel } from "@/components/queue/AssistantQueuePanel";

export default function AssistantQueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
        </div>
      }
    >
      <AssistantQueuePanel />
    </Suspense>
  );
}

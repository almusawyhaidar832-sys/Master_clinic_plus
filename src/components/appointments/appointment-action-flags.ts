export function appointmentActionFlags(status: string) {
  return {
    isPending: status === "pending",
    isCancelled: status === "cancelled",
    canCancel: ["scheduled", "confirmed", "waiting"].includes(status),
    canDelete: status === "cancelled",
    canEdit:
      status !== "cancelled" &&
      status !== "completed" &&
      status !== "in_examination" &&
      status !== "in_clinic",
  };
}

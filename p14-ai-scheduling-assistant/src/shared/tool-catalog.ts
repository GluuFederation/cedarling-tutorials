export const toolCatalog = {
  find_availability: {
    label: "Find availability",
    capability: "calendar.availability.read",
    action: "Calendar::ReadAvailability",
  },
  list_meetings: {
    label: "Refresh my meetings",
    capability: "meeting.read",
    action: "Meeting::Read",
  },
  schedule_meeting: {
    label: "Schedule meeting",
    capability: "meeting.schedule",
    action: "Meeting::Schedule",
  },
  reschedule_meeting: {
    label: "Reschedule meeting",
    capability: "meeting.reschedule",
    action: "Meeting::Reschedule",
  },
  cancel_meeting: {
    label: "Cancel meeting",
    capability: "meeting.cancel",
    action: "Meeting::Cancel",
  },
} as const;

export type ToolName = keyof typeof toolCatalog;
export type ToolDefinition = (typeof toolCatalog)[ToolName];
export type Capability = ToolDefinition["capability"];

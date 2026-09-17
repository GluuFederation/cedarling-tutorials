export const personas = [
  { id: "riley", initials: "RI", name: "Riley", context: "Article author" },
  { id: "ana", initials: "AN", name: "Ana", context: "Editor · Publisher" },
  { id: "omar", initials: "OM", name: "Omar", context: "Revocable editor" },
] as const;

export function personaForSubject(subject: string) {
  return personas.find((persona) => persona.id === subject);
}

// The BCSO rank progression captured from the current handbook/server clone.
// Discord role IDs remain server-specific and belong in RANK_ROLE_IDS.
export const BCSO_RANK_MATRIX = [
  { key: "DST", displayName: "Deputy Sheriff Trainee", aliases: ["Deputy Sheriff Trainee", "Probationary Deputy"] },
  { key: "Deputy", displayName: "Deputy", aliases: ["Deputy Sheriff"] },
  { key: "Senior Deputy", displayName: "Senior Deputy", aliases: [] },
  { key: "Corporal", displayName: "Corporal", aliases: [] },
  { key: "Sergeant", displayName: "Sergeant", aliases: [] },
  { key: "Staff Sergeant", displayName: "Staff Sergeant", aliases: [] },
  { key: "2nd Lieutenant", displayName: "2nd Lieutenant", aliases: [] },
  { key: "1st Lieutenant", displayName: "1st Lieutenant", aliases: [] },
  { key: "Captain", displayName: "Captain", aliases: [] },
  { key: "Major", displayName: "Major", aliases: [] },
  { key: "Commander", displayName: "Commander", aliases: ["Area Commander"] },
  { key: "Division Chief", displayName: "Division Chief", aliases: [] },
  { key: "Chief Deputy", displayName: "Chief Deputy", aliases: [] },
  { key: "Assistant Sheriff", displayName: "Assistant Sheriff", aliases: [] },
  { key: "UnderSheriff", displayName: "UnderSheriff", aliases: ["Undersheriff"] },
  { key: "Sheriff", displayName: "Sheriff", aliases: [] }
];

export const REQUIRED_RANK_KEYS = BCSO_RANK_MATRIX.map(rank => rank.key);


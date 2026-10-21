import type { BoardCell, MatchSnapshot, Player } from "./contracts.ts";

const groups = [
  [
    "Harbor",
    "#8e533b",
    100,
    10,
    50,
    [
      [1, "West Quay"],
      [2, "Copper Dock"],
      [4, "Tide Street"],
    ],
  ],
  [
    "Market",
    "#59a5ba",
    120,
    12,
    60,
    [
      [6, "Orchard Row"],
      [7, "Merchant Lane"],
      [9, "Exchange Street"],
    ],
  ],
  [
    "Arts",
    "#b1568c",
    140,
    14,
    70,
    [
      [11, "Studio Walk"],
      [12, "Gallery Lane"],
      [14, "Theatre Street"],
    ],
  ],
  [
    "Meadow",
    "#cd8746",
    160,
    16,
    80,
    [
      [16, "Clover Avenue"],
      [17, "Willow Row"],
      [19, "Brook Street"],
    ],
  ],
  [
    "Garden",
    "#378464",
    180,
    18,
    90,
    [
      [21, "Cedar Grove"],
      [22, "Fern Avenue"],
      [24, "Palm Court"],
    ],
  ],
  [
    "Foundry",
    "#bc5252",
    200,
    20,
    100,
    [
      [26, "Forge Road"],
      [27, "Kiln Street"],
      [29, "Workshop Avenue"],
    ],
  ],
  [
    "Skyline",
    "#5567af",
    220,
    22,
    110,
    [
      [31, "Beacon Row"],
      [32, "Observatory Lane"],
      [34, "Horizon Avenue"],
    ],
  ],
  [
    "Summit",
    "#a48b23",
    240,
    24,
    120,
    [
      [36, "Crest Road"],
      [37, "Ridge Avenue"],
      [39, "Summit Court"],
    ],
  ],
] as const;
const neutral = new Map<number, string>([
  [0, "Start Plaza"],
  [5, "Canal Walk"],
  [10, "Civic Square"],
  [15, "Sculpture Park"],
  [20, "Grand Park"],
  [25, "River Walk"],
  [30, "Transit Plaza"],
  [35, "Hill Park"],
]);
const services = new Map<number, string>([
  [3, "Ferry Stop"],
  [8, "Cycle Hub"],
  [13, "Tram Stop"],
  [18, "Parcel Hub"],
  [23, "Shuttle Stop"],
  [28, "Freight Hub"],
  [33, "Metro Stop"],
  [38, "Bus Hub"],
]);
export const BOARD: readonly BoardCell[] = Array.from(
  { length: 40 },
  (_, index) => {
    for (const [
      group,
      color,
      price,
      baseRent,
      buildingCost,
      members,
    ] of groups) {
      const member = members.find(([position]) => position === index);
      if (member)
        return {
          id: `space-${index}`,
          index,
          name: member[1],
          kind: "property",
          group,
          color,
          price,
          baseRent,
          buildingCost,
        };
    }
    return {
      id: `space-${index}`,
      index,
      name: services.get(index) ?? neutral.get(index) ?? "",
      kind: services.has(index) ? "service" : "neutral",
      group: null,
      color: null,
      price: services.has(index) ? 150 : 0,
      baseRent: services.has(index) ? 15 : 0,
      buildingCost: 0,
    };
  },
);
export const PLAYER_COLORS = [
  "#145a9c",
  "#a43970",
  "#945a15",
  "#4d6e30",
] as const;
export function valueAssets(match: MatchSnapshot, player: Player) {
  let propertyValue = 0;
  let buildingValue = 0;
  for (const property of match.properties) {
    if (property.ownerId !== player.id) continue;
    const cell = BOARD.find((entry) => entry.id === property.id);
    if (!cell) throw new Error("Unknown board property");
    propertyValue += cell.price;
    buildingValue += cell.buildingCost * property.level;
  }
  return {
    cash: player.cash,
    propertyValue,
    buildingValue,
    netWorth: player.cash + propertyValue + buildingValue,
  };
}

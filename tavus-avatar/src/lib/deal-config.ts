export interface DealConfig {
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  per_day_price: string;
}

export const DEFAULT_DEAL_CONFIG: DealConfig = {
  vehicle_year: "2026",
  vehicle_make: "Mazda",
  vehicle_model: "CX five",
  per_day_price: "four dollars",
};

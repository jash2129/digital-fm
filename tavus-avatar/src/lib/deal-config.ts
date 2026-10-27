export interface DealConfig {
  dealership_name?: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  per_day_price: string;
}

export const HYUNDAI_DEAL_CONFIG: DealConfig = {
  dealership_name: "Hyundai of Dallas",
  vehicle_year: "2026",
  vehicle_make: "Hyundai",
  vehicle_model: "Tucson",
  per_day_price: "four dollars",
};

export const DEFAULT_DEAL_CONFIG: DealConfig = {
  dealership_name: "Mazda Dealership",
  vehicle_year: "2026",
  vehicle_make: "Mazda",
  vehicle_model: "CX five",
  per_day_price: "four dollars",
};

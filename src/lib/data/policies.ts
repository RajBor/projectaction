export interface Policy {
  name: string;
  sh: string;
  imp: string;
  comp: string[];
  desc: string;
}

export const POLICIES: Policy[] = [
  {name:"PM Surya Ghar Muft Bijli Yojana",sh:"PMSGMBY",imp:"Direct",comp:["solar_modules","inverters","mounting","mc4_connector","smart_meters"],desc:"1 crore rooftop solar; ₹75,000Cr. Residential module, inverter, mounting, smart meter demand."},
  {name:"PLI Scheme — Solar PV",sh:"PLI-Solar",imp:"Direct",comp:["solar_modules","solar_cells","wafers","pv_glass","encapsulants","al_frame","backsheet"],desc:"₹24,000Cr for 65GW integrated mfg. Poly→wafer→cell→module chain incentive."},
  {name:"ALMM",sh:"ALMM",imp:"Direct",comp:["solar_modules","solar_cells","wafers","pv_glass","al_frame"],desc:"Mandatory procurement from MNRE-listed manufacturers. Creates domestic moat."},
  {name:"Basic Customs Duty (BCD)",sh:"BCD",imp:"Direct",comp:["solar_modules","solar_cells","polysilicon","wafers","pv_glass"],desc:"40% BCD modules; 25% cells. Strongest protection for domestic manufacturers."},
  {name:"RDSS — Revamped Distribution",sh:"RDSS",imp:"Direct",comp:["smart_meters","dist_transformers","hv_cables","switchgear","ems"],desc:"₹3.03 lakh Cr. 250M smart meters + infrastructure upgrade."},
  {name:"PM KUSUM",sh:"PM-KUSUM",imp:"Direct",comp:["solar_modules","inverters","mounting","dist_transformers"],desc:"7.5L agricultural pump solarisation + 10GW decentralised solar."},
  {name:"National Solar Mission 500GW",sh:"NSM-500GW",imp:"Direct",comp:["solar_modules","solar_cells","power_transformers","htls","hv_cables","bess","ems"],desc:"500GW RE by 2030. Requires 280+ GW solar — primary value chain demand driver."},
  {name:"ISTS Waiver",sh:"ISTS-Waiver",imp:"Indirect",comp:["power_transformers","acsr_conductors","htls","switchgear","ems"],desc:"Transmission charge waiver for inter-state RE projects before Dec 2026."},
  {name:"Green Energy Corridor",sh:"GEC",imp:"Direct",comp:["power_transformers","htls","acsr_conductors","switchgear","ems","bess"],desc:"₹12,000Cr+ dedicated RE transmission corridors."},
  {name:"National Electricity Plan 2032",sh:"NEP-2032",imp:"Direct",comp:["power_transformers","dist_transformers","htls","acsr_conductors","hv_cables","switchgear","bess","ems"],desc:"500+ GW RE; ₹12L Cr transmission investment; 51GW storage."},
  {name:"Electricity Amendment Rules 2022",sh:"EA-Rules",imp:"Indirect",comp:["smart_meters","ems"],desc:"ToD tariff mandatory; smart metering milestones — accelerates AMI."},
  {name:"PLI — Advanced Chemistry Cell",sh:"PLI-ACC",imp:"Direct",comp:["bess"],desc:"₹18,100Cr for 50GWh ACC battery manufacturing."},
  {name:"BIS / Quality Control Orders",sh:"QCO-Solar",imp:"Direct",comp:["solar_modules","inverters","mc4_connector","junction_box","solar_cells"],desc:"Mandatory BIS certification. Bars low-quality imports."},
  {name:"SECI / NTPC Bulk Tenders",sh:"SECI-Tenders",imp:"Direct",comp:["solar_modules","power_transformers","bess","ems"],desc:"State procurement benchmarks and volume drivers."},
];

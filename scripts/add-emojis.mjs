#!/usr/bin/env node
// One-shot: walk data/takeaway-mock.json and stamp a slackEmoji on each dish.
// Curated so the top-10 of every restaurant has no emoji collisions.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "data", "takeaway-mock.json");

const EMOJI_BY_DISH = {
  // Pizza Belga
  "d-001-01": "pizza",          // Margherita
  "d-001-02": "cheese_wedge",   // Quattro Formaggi
  "d-001-03": "hot_pepper",     // Diavola (spicy)
  "d-001-04": "mushroom",       // Prosciutto e Funghi
  "d-001-05": "herb",           // Tartufo (truffle)
  "d-001-06": "pineapple",      // Hawaii
  "d-001-07": "pie",            // Lasagne al Forno
  "d-001-08": "spaghetti",      // Spaghetti Carbonara
  "d-001-09": "cake",           // Tiramisù
  "d-001-10": "tomato",         // Bruschetta Pomodoro
  "d-001-11": "leafy_green",    // Caprese
  "d-001-12": "dumpling",       // Calzone

  // Wok-In Express
  "d-002-01": "ramen",          // Pad Thai
  "d-002-02": "rice",           // Bibimbap
  "d-002-03": "takeout_box",    // Yakisoba
  "d-002-04": "cucumber",       // Spring Rolls
  "d-002-05": "duck",           // Crispy Duck
  "d-002-06": "curry",          // Green Curry
  "d-002-07": "pineapple",      // Sweet & Sour
  "d-002-08": "cut_of_meat",    // Beef in Black Bean
  "d-002-09": "stew",           // Tom Kha Gai
  "d-002-10": "mango",          // Mango Sticky Rice
  "d-002-11": "dumpling",       // Gyoza

  // Frituur 't Vlaamsche
  "d-003-01": "fries",          // Frieten
  "d-003-02": "baguette_bread", // Mitraillette
  "d-003-03": "hamburger",      // Bicky Burger
  "d-003-04": "hotdog",         // Frikandel
  "d-003-05": "stew",           // Stoofvlees
  "d-003-06": "pie",            // Vol-au-vent
  "d-003-07": "8ball",          // Boulet Liégeois (round meatball)
  "d-003-08": "meat_on_bone",   // Curryworst
  "d-003-09": "burrito",        // Loempia
  "d-003-10": "stuffed_flatbread", // Kapsalon
  "d-003-11": "croissant",      // Sausage Roll

  // Sushi Tokyo
  "d-004-01": "sushi",          // Salmon Nigiri
  "d-004-02": "dragon",         // Dragon Roll
  "d-004-03": "fish",           // Sashimi
  "d-004-04": "hot_pepper",     // Spicy Tuna
  "d-004-05": "avocado",        // California Roll
  "d-004-06": "bento",          // Chicken Teriyaki Bento
  "d-004-07": "seedling",       // Edamame
  "d-004-08": "stew",           // Miso Soup
  "d-004-09": "dumpling",       // Gyoza
  "d-004-10": "rice_ball",      // Mochi
  "d-004-11": "shrimp",         // Tempura

  // Burger Story
  "d-005-01": "hamburger",      // Story Classic
  "d-005-02": "cut_of_meat",    // Double Smash
  "d-005-03": "bacon",          // BBQ Bacon
  "d-005-04": "mushroom",       // Truffle Burger
  "d-005-05": "poultry_leg",    // Chicken Crunch
  "d-005-06": "leafy_green",    // Veggie Bean
  "d-005-07": "fries",          // Loaded Fries
  "d-005-08": "onion",          // Onion Rings
  "d-005-09": "cheese_wedge",   // Mac & Cheese
  "d-005-10": "chocolate_bar",  // Brownie

  // Curry Palace
  "d-006-01": "curry",          // Tikka Masala
  "d-006-02": "cut_of_meat",    // Rogan Josh
  "d-006-03": "cheese_wedge",   // Paneer
  "d-006-04": "hot_pepper",     // Vindaloo
  "d-006-05": "stew",           // Dal Makhani
  "d-006-06": "bread",          // Garlic Naan
  "d-006-07": "coconut",        // Peshwari Naan
  "d-006-08": "dumpling",       // Samosa
  "d-006-09": "rice",           // Biryani
  "d-006-10": "mango",          // Mango Lassi
  "d-006-11": "doughnut",       // Gulab Jamun

  // Pita King
  "d-007-01": "stuffed_flatbread", // Pita Kapsalon
  "d-007-02": "poultry_leg",    // Pita Kip
  "d-007-03": "burrito",        // Durum
  "d-007-04": "falafel",        // Pita Falafel
  "d-007-05": "flatbread",      // Lahmacun
  "d-007-06": "cut_of_meat",    // Mixed Grill
  "d-007-07": "peanuts",        // Hummus
  "d-007-08": "honey_pot",      // Baklava
  "d-007-09": "tea",            // Turkish Tea
  "d-007-10": "glass_of_milk",  // Ayran

  // Trattoria Roma
  "d-008-01": "pizza",          // Margherita DOP
  "d-008-02": "spaghetti",      // Tagliatelle al Ragù
  "d-008-03": "rice",           // Risotto ai Funghi
  "d-008-04": "cut_of_meat",    // Vitello Tonnato
  "d-008-05": "cheese_wedge",   // Burrata
  "d-008-06": "pig",            // Saltimbocca
  "d-008-07": "cake",           // Tiramisù
  "d-008-08": "ice_cream",      // Panna Cotta
  "d-008-09": "dumpling",       // Gnocchi
  "d-008-10": "tomato",         // Caprese

  // Pho Saigon
  "d-009-01": "ramen",          // Pho Bo
  "d-009-02": "poultry_leg",    // Pho Ga
  "d-009-03": "hot_pepper",     // Bun Bo Hue (spicy)
  "d-009-04": "sandwich",       // Banh Mi
  "d-009-05": "leafy_green",    // Goi Cuon (summer rolls)
  "d-009-06": "dumpling",       // Cha Gio
  "d-009-07": "rice",           // Com Tam
  "d-009-08": "cut_of_meat",    // Bun Cha
  "d-009-09": "coffee",         // Vietnamese Iced Coffee
  "d-009-10": "ice_cream",      // Che Ba Mau

  // Taco Loco
  "d-010-01": "taco",           // Tacos al Pastor
  "d-010-02": "pig",            // Tacos Carnitas
  "d-010-03": "burrito",        // Burrito Carne Asada
  "d-010-04": "cheese_wedge",   // Quesadilla
  "d-010-05": "hot_pepper",     // Nachos Supreme
  "d-010-06": "avocado",        // Guacamole
  "d-010-07": "stuffed_flatbread", // Chimichanga
  "d-010-08": "corn",           // Elote
  "d-010-09": "chocolate_bar",  // Churros
  "d-010-10": "glass_of_milk",  // Horchata
};

const data = JSON.parse(readFileSync(dataPath, "utf-8"));
let updated = 0;
let missing = [];
for (const dish of data.dishes) {
  const emoji = EMOJI_BY_DISH[dish.id];
  if (!emoji) {
    missing.push(dish.id);
    continue;
  }
  dish.slackEmoji = emoji;
  updated++;
}

writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
console.log(`Updated ${updated} dishes.`);
if (missing.length) console.warn(`Missing emoji for: ${missing.join(", ")}`);

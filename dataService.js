/**
 * QuickBite Unified Data Service
 * Handles categories, food dishes, and live orders.
 * Persists locally via localStorage and includes a Supabase-ready adapter structure.
 */

import { supabase } from './supabaseClient.js';

const STORAGE_KEYS = {
  CATEGORIES: 'quickbite_categories',
  CATEGORY_IMAGES: 'quickbite_category_images',
  DISHES: 'quickbite_dishes',
  ORDERS: 'quickbite_orders',
  SETTINGS: 'quickbite_settings',
  ADDRESSES: 'quickbite_user_addresses',
  USER: 'quickbite_custom_user',
  UPLOADED_IMAGES: 'quickbite_uploaded_images'
};

export const ORDER_STATUS_RANKS = {
  'pending': 0,
  'accepted': 1,
  'cooking': 2,
  'ready_for_pickup': 3,
  'on_the_way': 4,
  'delivered': 5,
  'cancelled': -1
};

// ========================================================
// INDEXEDDB RESILIENT PERSISTENCE LAYER (No 5MB Quota Limits)
// ========================================================
const IDB_NAME = 'quickbite_unified_db';
const IDB_VERSION = 1;
const IDB_STORE = 'app_storage';

function openIDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('[IDB] open error:', req.error);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function idbGet(key) {
  try {
    const db = await openIDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key, val) {
  try {
    const db = await openIDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(val, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function idbDelete(key) {
  try {
    const db = await openIDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}


// Fixed restaurant coordinates backend anchor for Savera Paradise: 12.72088913328626, 77.28051033981335 (Aga Complex, Railway Station Road, Ramanagara)
export const RESTAURANT_COORDINATES = Object.freeze({
  lat: 12.72088913328626,
  lng: 77.28051033981335,
  dms: '12°43\'15.2"N 77°16\'49.8"E',
  name: 'Savera Paradise',
  address: 'Railway Station Road, Ramanagara',
  mapsUrl: 'https://www.google.com/maps/place/Savera+Paradise/@12.7208891,77.2805103,17z'
});

export const DEFAULT_SETTINGS = {
  storeOpen: true,
  storeClosedReason: 'The kitchen is currently closed for the night. We will reopen tomorrow at 11:00 AM!',
  openTime: '11:00 AM',
  closeTime: '11:00 PM',
  statusNotice: 'Open Now: 11:00 AM – 11:00 PM • Delivery & Pickup',
  isRushPaused: false,
  pauseUntil: null,
  pauseMinutes: 20,
  pauseReason: 'High kitchen rush — orders temporarily paused',
  // Fixed backend coordinates anchor (12°43'15.2"N 77°16'49.8"E)
  restaurantName: 'Savera Paradise',
  restaurantAddress: 'Railway Station Road, Ramanagara',
  restaurantMapsUrl: 'https://www.google.com/maps/place/Savera+Paradise/@12.7208891,77.2805103,17z',
  restaurantLat: RESTAURANT_COORDINATES.lat,
  restaurantLng: RESTAURANT_COORDINATES.lng,
  deliveryRadiusKm: 7,
  restaurantPhone: '+91 98450 12345',
  helpline: '+91 98450 12345',
  // Delivery Settings & Free Delivery Threshold
  deliveryFeeStandard: 40,
  minOrderValue: 0, // Minimum order value to place an order (0 = no minimum order limit)
  freeDeliveryEnabled: true,
  freeDeliveryThreshold: 250, // orders above 250 get free delivery
  maxActiveOrdersPerCustomer: 2, // Cannot make 3rd order until 1st order is delivered (max 2 active undelivered orders at a time)
  // Promotional Offer & Coupon Settings
  offerActive: true,
  offerCode: 'SAVERA20',
  offerDiscountType: 'percent', // 'percent' | 'flat'
  offerDiscountPercent: 20,
  offerDiscountAmount: 50, // e.g. 50 off
  offerMinOrder: 250, // valid above orders 250
  offerTitle: 'Craving Savera? Get 20% OFF Today!',
  offerSubtext: 'Use coupon code at checkout for 20% off plus 100% Free Shipping.',
  offerFreeDelivery: true
};

// ========================================================
// DEFAULT SEED DATA
// ========================================================
export const DEFAULT_ORDERS = [];

export const DEFAULT_RIDERS = [];

export const DEFAULT_CATEGORIES = [
  {
    "id": "cat-biryani",
    "name": "Rice & Biryani",
    "emoji": "🍚",
    "image": "/api/r2-image?key=categories%2FGemini_Generated_Image_bm077mbm077mbm07-removebg-preview.png",
    "slug": "biryani"
  },
  {
    "id": "cat-bbq",
    "name": "BBQ & Tandoori",
    "emoji": "🔥",
    "image": "/api/r2-image?key=categories%2FGemini_Generated_Image_9ocagm9ocagm9oca__3_-removebg-preview.png",
    "slug": "bbq-tandoori"
  },
  {
    "id": "cat-seafood",
    "name": "Sea Food Dishes",
    "emoji": "🦐",
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "slug": "seafood"
  },
  {
    "id": "cat-chinese",
    "name": "Chinese Dry",
    "emoji": "🥢",
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "slug": "chinese-dry"
  },
  {
    "id": "cat-kebab",
    "name": "Kebab Specials",
    "emoji": "🍢",
    "image": "/api/r2-image?key=categories%2FGemini_Generated_Image_cd6g2ncd6g2ncd6g-removebg-preview.png",
    "slug": "kabab-spl"
  },
  {
    "id": "cat-gravy",
    "name": "Chicken Gravies",
    "emoji": "🍲",
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "slug": "chicken-gravy"
  },
  {
    "id": "cat-roti",
    "name": "Roti & Breads",
    "emoji": "🫓",
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "slug": "roti-items"
  },
  {
    "id": "cat-shawarma",
    "name": "Shawarma & Rolls",
    "emoji": "🌯",
    "image": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80",
    "slug": "shawarma-rolls"
  },
  {
    "id": "cat-veg",
    "name": "Veg Gravy & Dal",
    "emoji": "🥗",
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "slug": "veg-gravy"
  }
];

export const DEFAULT_DISHES = [
  {
    "id": "dish-biryani-rice-2pc-kebab",
    "name": "Biryani Rice & 2 Piece Kebab",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 130,
    "image": "/biryani-plate-1.png",
    "badge": "🔥 Value Combo",
    "time": "10 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Aromatic Biryani rice served with 2 crispy golden fried chicken kebabs.",
    "inStock": true
  },
  {
    "id": "dish-chicken-biryani-full",
    "name": "Chicken Biryani (Full)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 210,
    "image": "/biryani-plate-2.png",
    "badge": "⭐ Bestseller",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Royal Dum Biryani loaded with tender, spiced chicken pieces and fragrant long-grain Basmati rice.",
    "inStock": true
  },
  {
    "id": "dish-chicken-biryani-half",
    "name": "Chicken Biryani (Half)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 170,
    "image": "/biryani-plate-2.png",
    "badge": "⭐ Popular",
    "time": "10 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Single-portion authentic Chicken Dum Biryani cooked with secret spices.",
    "inStock": true
  },
  {
    "id": "dish-biryani-rice-full",
    "name": "Biryani Rice (Full)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 95,
    "image": "/biryani-plate-1.png",
    "badge": "Popular",
    "time": "5 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Full portion of rich, spiced Biryani Kuska rice simmered in chicken broth.",
    "inStock": true
  },
  {
    "id": "dish-biryani-rice-half",
    "name": "Biryani Rice (Half)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 82,
    "image": "/biryani-plate-1.png",
    "badge": "",
    "time": "5 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of aromatic spiced Biryani Kuska rice.",
    "inStock": true
  },
  {
    "id": "dish-ghee-rice-full",
    "name": "Ghee Rice (Full)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 89,
    "image": "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=500&auto=format&fit=crop&q=80",
    "badge": "Chef Special",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Fluffy Basmati rice gently sautéed in pure desi ghee with cashews and mild spices.",
    "inStock": true
  },
  {
    "id": "dish-ghee-rice-half",
    "name": "Ghee Rice (Half)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 79,
    "image": "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "8 - 10 mins",
    "diet": "Veg",
    "desc": "Half plate aromatic desi ghee rice.",
    "inStock": true
  },
  {
    "id": "dish-jeera-rice-full",
    "name": "Jeera Rice (Full)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 105,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Fragrant cumin-tempered Basmati rice garnished with fresh coriander.",
    "inStock": true
  },
  {
    "id": "dish-jeera-rice-half",
    "name": "Jeera Rice (Half)",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 89,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "8 - 10 mins",
    "diet": "Veg",
    "desc": "Half plate cumin-flavored Basmati rice.",
    "inStock": true
  },
  {
    "id": "dish-chicken-fried-rice",
    "name": "Chicken Fried Rice",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 170,
    "image": "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=500&auto=format&fit=crop&q=80",
    "badge": "Wok Special",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Wok-tossed rice with tender shredded chicken, scrambled eggs, and crunchy spring onions.",
    "inStock": true
  },
  {
    "id": "dish-veg-fried-rice",
    "name": "Veg Fried Rice",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 139,
    "image": "https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Garden fresh carrots, beans, and capsicum tossed with aromatic rice in Chinese wok style.",
    "inStock": true
  },
  {
    "id": "dish-egg-fried-rice",
    "name": "Egg Fried Rice",
    "category": "biryani",
    "categoryName": "Rice & Biryani",
    "price": 139,
    "image": "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Egg",
    "desc": "Classic Indo-Chinese fried rice stir-fried with fluffy scrambled eggs and mild peppers.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-chicken-full",
    "name": "Tandoori Chicken (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 499,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "🔥 Charcoal Grilled",
    "time": "20 - 25 mins",
    "diet": "Non-Veg",
    "desc": "Whole chicken marinated overnight in spiced yogurt, charred to smoky perfection in clay tandoor.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-chicken-half",
    "name": "Tandoori Chicken (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "Popular",
    "time": "18 - 20 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of authentic charcoal roasted tandoori chicken served with mint chutney.",
    "inStock": true
  },
  {
    "id": "dish-grilled-chicken-full",
    "name": "Grilled Chicken (Full) (Starts 3 PM)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 499,
    "image": "https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=500&auto=format&fit=crop&q=80",
    "badge": "⏰ Starts 3 PM",
    "time": "20 - 25 mins",
    "diet": "Non-Veg",
    "desc": "Juicy Arabian-spiced whole chicken slow grilled on rotisserie skewers.",
    "inStock": true
  },
  {
    "id": "dish-grilled-chicken-half",
    "name": "Grilled Chicken (Half) (Starts 3 PM)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=500&auto=format&fit=crop&q=80",
    "badge": "⏰ Starts 3 PM",
    "time": "18 - 20 mins",
    "diet": "Non-Veg",
    "desc": "Half portion rotisserie chicken spiced with garlic, pepper, and herbs.",
    "inStock": true
  },
  {
    "id": "dish-alfaham-chicken-full",
    "name": "Alfaham Chicken (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 499,
    "image": "https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Arabian Legend",
    "time": "20 - 25 mins",
    "diet": "Non-Veg",
    "desc": "Authentic Arabian charcoal grilled chicken basted with lemon, green chilies, and Gulf spices.",
    "inStock": true
  },
  {
    "id": "dish-alfaham-chicken-half",
    "name": "Alfaham Chicken (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80",
    "badge": "Popular",
    "time": "18 - 20 mins",
    "diet": "Non-Veg",
    "desc": "Half plate smoky charcoal-cooked Arabian Alfaham chicken.",
    "inStock": true
  },
  {
    "id": "dish-hariyali-kebab-full",
    "name": "Hariyali Kebab (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Boneless chicken chunks marinated in mint, coriander, and green chili pesto, grilled in tandoor.",
    "inStock": true
  },
  {
    "id": "dish-hariyali-kebab-half",
    "name": "Hariyali Kebab (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half portion green herb chicken kebabs.",
    "inStock": true
  },
  {
    "id": "dish-kalmi-kebab",
    "name": "Kalmi Kebab",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 95,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Mughlai",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Succulent chicken drumstick marinated in creamy cashew, cardamom, and saffron marinade.",
    "inStock": true
  },
  {
    "id": "dish-chicken-tikka-full",
    "name": "Chicken Tikka (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "Classic",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Boneless chicken cubes skewers roasted red hot with Kashmiri chili and mustard oil.",
    "inStock": true
  },
  {
    "id": "dish-chicken-tikka-half",
    "name": "Chicken Tikka (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of authentic charcoal grilled chicken tikka.",
    "inStock": true
  },
  {
    "id": "dish-malai-tikka-full",
    "name": "Malai Tikka (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Creamy",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Melt-in-mouth chicken pieces steeped in cream, cheese, white pepper, and green cardamom.",
    "inStock": true
  },
  {
    "id": "dish-malai-tikka-half",
    "name": "Malai Tikka (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate rich and silky cream malai tikka.",
    "inStock": true
  },
  {
    "id": "dish-hyderabadi-kebab-full",
    "name": "Hyderabadi Kebab (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "Spicy",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Deccan spiced fiery tandoori chicken kebab infused with roasted spices.",
    "inStock": true
  },
  {
    "id": "dish-hyderabadi-kebab-half",
    "name": "Hyderabadi Kebab (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half portion spicy Hyderabadi kebab.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-kebab-full",
    "name": "Tandoori Kebab (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 249,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Full plate roasted chicken kebabs straight from the clay pit.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-kebab-half",
    "name": "Tandoori Kebab (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate roasted chicken kebabs.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-masala-full",
    "name": "Tandoori Masala (Full)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 540,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Signature",
    "time": "20 - 25 mins",
    "diet": "Non-Veg",
    "desc": "Charcoal grilled tandoori chicken simmered in rich, buttery, spiced tomato gravy.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-masala-half",
    "name": "Tandoori Masala (Half)",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 290,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "18 - 20 mins",
    "diet": "Non-Veg",
    "desc": "Half plate smoky tandoori chicken in spicy gravy.",
    "inStock": true
  },
  {
    "id": "dish-teetar-kebab",
    "name": "Teetar Kebab",
    "category": "bbq-tandoori",
    "categoryName": "BBQ & Tandoori",
    "price": 170,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Exotic",
    "time": "15 - 20 mins",
    "diet": "Non-Veg",
    "desc": "Marinated quail meat roasted over glowing coal embers.",
    "inStock": true
  },
  {
    "id": "dish-prawns-pepper-dry",
    "name": "Prawns Pepper Dry",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 370,
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Chef Special",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Juicy sea prawns tossed with crushed Malabar black pepper, curry leaves, and browned onions.",
    "inStock": true
  },
  {
    "id": "dish-prawns-dry",
    "name": "Prawns Dry",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 370,
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Crisp pan-fried fresh prawns coated with coastal spices.",
    "inStock": true
  },
  {
    "id": "dish-prawns-chilli",
    "name": "Prawns Chilli",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 370,
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "badge": "Spicy",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Wok-fried prawns tossed in spicy soya sauce, fresh green chilies, and bell peppers.",
    "inStock": true
  },
  {
    "id": "dish-prawns-kabab",
    "name": "Prawns Kabab",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 370,
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Crispy battered and deep-fried succulent prawns sprinkled with chaat masala.",
    "inStock": true
  },
  {
    "id": "dish-prawns-masala",
    "name": "Prawns Masala",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 370,
    "image": "https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80",
    "badge": "Gravy",
    "time": "18 - 20 mins",
    "diet": "Seafood",
    "desc": "Tender prawns cooked in a rich, tangy onion-tomato gravy with aromatic coastal spices.",
    "inStock": true
  },
  {
    "id": "dish-fish-masala",
    "name": "Fish Masala",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 250,
    "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    "badge": "Popular",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Fresh fish steaks simmered in traditional spiced curry gravy.",
    "inStock": true
  },
  {
    "id": "dish-fish-tikka",
    "name": "Fish Tikka",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 250,
    "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    "badge": "Tandoori",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Boneless fish cubes marinated in ajwain, yogurt, and chili, roasted in clay tandoor.",
    "inStock": true
  },
  {
    "id": "dish-chilli-fish",
    "name": "Chilli Fish",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 250,
    "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    "badge": "Indo-Chinese",
    "time": "12 - 15 mins",
    "diet": "Seafood",
    "desc": "Crispy batter-fried fish tossed with dark soy, garlic, and hot green peppers.",
    "inStock": true
  },
  {
    "id": "dish-apolo-fish",
    "name": "Apolo Fish",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 250,
    "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    "badge": "Hyderabadi",
    "time": "15 - 18 mins",
    "diet": "Seafood",
    "desc": "Boneless fish tossed in spicy yogurt, curry leaves, ginger, and South Indian spices.",
    "inStock": true
  },
  {
    "id": "dish-teetar-pepper-dry",
    "name": "Teetar Pepper Dry",
    "category": "seafood",
    "categoryName": "Sea Food Dishes",
    "price": 150,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Specialty",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Quail pieces pan-roasted with fresh crushed black pepper and onions.",
    "inStock": true
  },
  {
    "id": "dish-special-noori-chicken",
    "name": "Special Noori Chicken",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 380,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "👑 House Special",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Signature house specialty chicken tossed in secret spicy rich red sauce with garlic crunch.",
    "inStock": true
  },
  {
    "id": "dish-chicken-manchurian-full",
    "name": "Chicken Manchurian (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "Popular",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Crispy fried chicken balls tossed in garlic, ginger, and tangy soya Manchurian glaze.",
    "inStock": true
  },
  {
    "id": "dish-chicken-manchurian-half",
    "name": "Chicken Manchurian (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of classic Indo-Chinese Chicken Manchurian.",
    "inStock": true
  },
  {
    "id": "dish-chilli-chicken-full",
    "name": "Chilli Chicken (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "🔥 Spicy",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Deep-fried chicken chunks stir-fried with capsicum, onions, and hot green chillies.",
    "inStock": true
  },
  {
    "id": "dish-chilli-chicken-half",
    "name": "Chilli Chicken (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of spicy wok-tossed Chilli Chicken.",
    "inStock": true
  },
  {
    "id": "dish-chicken-65-full",
    "name": "Chicken 65 (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ All-Time Fav",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Crispy chicken morsels tempered with fiery curry leaves, slit chillies, and garlic.",
    "inStock": true
  },
  {
    "id": "dish-chicken-65-half",
    "name": "Chicken 65 (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of crunchy Chicken 65.",
    "inStock": true
  },
  {
    "id": "dish-chicken-lollipop-full",
    "name": "Chicken Lollipop (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80",
    "badge": "Crispy",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Frenched chicken winglets deep-fried with crunchy batter, served with spicy Schezwan dip.",
    "inStock": true
  },
  {
    "id": "dish-chicken-lollipop-half",
    "name": "Chicken Lollipop (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate crispy chicken wing lollipops.",
    "inStock": true
  },
  {
    "id": "dish-pepper-chicken-full",
    "name": "Pepper Chicken (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Chicken sautéed in fresh crushed black pepper, onions, and aromatic herbs.",
    "inStock": true
  },
  {
    "id": "dish-pepper-chicken-half",
    "name": "Pepper Chicken (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of peppery chicken dry.",
    "inStock": true
  },
  {
    "id": "dish-schezwan-chicken-full",
    "name": "Schezwan Chicken (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "Hot",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Wok-fried chicken in spicy, pungent Schezwan sauce with celery and red peppers.",
    "inStock": true
  },
  {
    "id": "dish-schezwan-chicken-half",
    "name": "Schezwan Chicken (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of hot Schezwan chicken.",
    "inStock": true
  },
  {
    "id": "dish-lemon-chicken-full",
    "name": "Lemon Chicken (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "Tangy",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Crispy chicken glazed in a zesty, sweet and sour lemon sauce.",
    "inStock": true
  },
  {
    "id": "dish-lemon-chicken-half",
    "name": "Lemon Chicken (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half plate tangy lemon chicken.",
    "inStock": true
  },
  {
    "id": "dish-chicken-555-full",
    "name": "Chicken 555 (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "Specialty",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Crispy chicken strips coated with spicy Andhra masala, garlic, and mint.",
    "inStock": true
  },
  {
    "id": "dish-chicken-555-half",
    "name": "Chicken 555 (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half plate spicy Chicken 555.",
    "inStock": true
  },
  {
    "id": "dish-chicken-pepper-dry-full",
    "name": "Chicken Pepper Dry (Full)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 260,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Dry roasted chicken tossed in roasted pepper and onion tempering.",
    "inStock": true
  },
  {
    "id": "dish-chicken-pepper-dry-half",
    "name": "Chicken Pepper Dry (Half)",
    "category": "chinese-dry",
    "categoryName": "Chinese Dry",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of chicken pepper dry.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kebab-full",
    "name": "Chicken Kebab (Full)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 220,
    "image": "/api/r2-image?key=categories%2FGemini_Generated_Image_cd6g2ncd6g2ncd6g-removebg-preview.png",
    "badge": "⭐ Crowd Favorite",
    "time": "10 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Crispy, juicy red fried chicken kebab seasoned with traditional spices.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kebab-half",
    "name": "Chicken Kebab (Half)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 145,
    "image": "/api/r2-image?key=categories%2FGemini_Generated_Image_cd6g2ncd6g2ncd6g-removebg-preview.png",
    "badge": "",
    "time": "8 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half plate crisp fried chicken kebab.",
    "inStock": true
  },
  {
    "id": "dish-green-kebab-full",
    "name": "Green Kebab (Full)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 220,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "Herb Spiced",
    "time": "10 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Golden fried chicken kebab coated in mint, coriander, and green chilli marinade.",
    "inStock": true
  },
  {
    "id": "dish-green-kebab-half",
    "name": "Green Kebab (Half)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 145,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "8 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half plate crispy green herb chicken kebab.",
    "inStock": true
  },
  {
    "id": "dish-yellow-kebab-full",
    "name": "Yellow Kebab (Full)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 220,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Mild",
    "time": "10 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Tender fried chicken kebab marinated with turmeric, ginger, and garlic.",
    "inStock": true
  },
  {
    "id": "dish-yellow-kebab-half",
    "name": "Yellow Kebab (Half)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 145,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "8 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Half plate crispy yellow spiced chicken kebab.",
    "inStock": true
  },
  {
    "id": "dish-fish-kebab",
    "name": "Fish Kebab",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 240,
    "image": "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    "badge": "Seafood",
    "time": "12 - 15 mins",
    "diet": "Seafood",
    "desc": "Fresh fish cutlets seasoned with spices and deep-fried to golden perfection.",
    "inStock": true
  },
  {
    "id": "dish-drumstick-chicken-3pcs",
    "name": "Drumstick Chicken (3 Pieces)",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 130,
    "image": "https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80",
    "badge": "Value 3-Pack",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "3 juicy, tender fried chicken drumsticks seasoned in authentic spices.",
    "inStock": true
  },
  {
    "id": "dish-chicken-stick-green",
    "name": "Chicken Stick Green",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 85,
    "image": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80",
    "badge": "Skewered",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Skewered boneless chicken chunks marinated in mint-coriander paste.",
    "inStock": true
  },
  {
    "id": "dish-chicken-stick-red",
    "name": "Chicken Stick Red",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 85,
    "image": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80",
    "badge": "Skewered",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Spicy red masala boneless chicken skewer fried crisp.",
    "inStock": true
  },
  {
    "id": "dish-chicken-stick-yellow",
    "name": "Chicken Stick Yellow",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 85,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Skewered",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Mild yellow-spiced boneless chicken skewer.",
    "inStock": true
  },
  {
    "id": "dish-chicken-chinese-stick",
    "name": "Chicken Chinese Stick",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 99,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "Indo-Chinese",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Soya-garlic glazed chicken cubes on skewers.",
    "inStock": true
  },
  {
    "id": "dish-chicken-leg-piece",
    "name": "Chicken Leg Piece",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 115,
    "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80",
    "badge": "Single",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Single jumbo chicken leg piece marinated and deep-fried crisp.",
    "inStock": true
  },
  {
    "id": "dish-chicken-wings",
    "name": "Chicken Wings",
    "category": "kabab-spl",
    "categoryName": "Kebab Specials",
    "price": 85,
    "image": "https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80",
    "badge": "Crispy",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Golden fried seasoned chicken wings with crunchy skin.",
    "inStock": true
  },
  {
    "id": "dish-butter-chicken-full",
    "name": "Butter Chicken (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ All-Time Best",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Tandoori chicken pieces in a silky, creamy tomato and butter makhani gravy.",
    "inStock": true
  },
  {
    "id": "dish-butter-chicken-half",
    "name": "Butter Chicken (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half portion of rich Butter Chicken.",
    "inStock": true
  },
  {
    "id": "dish-methi-chicken-full",
    "name": "Methi Chicken (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Aromatic",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Chicken simmered in fragrant fenugreek leaves and spiced onion gravy.",
    "inStock": true
  },
  {
    "id": "dish-methi-chicken-half",
    "name": "Methi Chicken (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate fragrant methi chicken curry.",
    "inStock": true
  },
  {
    "id": "dish-chicken-masala-full",
    "name": "Chicken Masala (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Dhaba Style",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Homestyle rich chicken curry cooked with roasted whole spices and onions.",
    "inStock": true
  },
  {
    "id": "dish-chicken-masala-half",
    "name": "Chicken Masala (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate Dhaba style chicken masala.",
    "inStock": true
  },
  {
    "id": "dish-kadai-chicken-full",
    "name": "Kadai Chicken (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Spicy",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Chicken cooked in an iron wok with freshly ground coriander seeds and bell peppers.",
    "inStock": true
  },
  {
    "id": "dish-kadai-chicken-half",
    "name": "Kadai Chicken (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate Kadai Chicken with bell peppers.",
    "inStock": true
  },
  {
    "id": "dish-chicken-hyderabadi-full",
    "name": "Chicken Hyderabadi (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Royal",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Nizami special chicken curry cooked with fried onions, coconut, and yogurt.",
    "inStock": true
  },
  {
    "id": "dish-chicken-hyderabadi-half",
    "name": "Chicken Hyderabadi (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate Hyderabadi chicken gravy.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kolhapuri-full",
    "name": "Chicken Kolhapuri (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Extra Hot",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Fiery Maharashtrian chicken curry with dry coconut, sesame, and red chillies.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kolhapuri-half",
    "name": "Chicken Kolhapuri (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate spicy Kolhapuri chicken curry.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kali-mirchi-full",
    "name": "Chicken Kali Mirchi (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Peppery",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Chicken in a rich cashew gravy loaded with freshly crushed black peppercorns.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kali-mirchi-half",
    "name": "Chicken Kali Mirchi (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate black pepper chicken gravy.",
    "inStock": true
  },
  {
    "id": "dish-chicken-mowgli-full",
    "name": "Chicken Mowgli (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Specialty",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Chef's signature spicy rustic chicken curry with bold rustic flavors.",
    "inStock": true
  },
  {
    "id": "dish-chicken-mowgli-half",
    "name": "Chicken Mowgli (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate Chicken Mowgli.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kurma-full",
    "name": "Chicken Kurma (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Mild",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Traditional South Indian kurma prepared with coconut paste and poppy seeds.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kurma-half",
    "name": "Chicken Kurma (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate coconut chicken kurma.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kassa-full",
    "name": "Chicken Kassa (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Semi-Dry",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Slow-roasted chicken in a rich, thick, deeply caramelized onion and ginger-garlic reduction.",
    "inStock": true
  },
  {
    "id": "dish-chicken-kassa-half",
    "name": "Chicken Kassa (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate thick roasted chicken kassa.",
    "inStock": true
  },
  {
    "id": "dish-chicken-hyderabadi-gravy-full",
    "name": "Chicken Hyderabadi Gravy (Full)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 259,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "Spicy",
    "time": "15 - 18 mins",
    "diet": "Non-Veg",
    "desc": "Rich green chili and mint Hyderabadi style spicy chicken curry.",
    "inStock": true
  },
  {
    "id": "dish-chicken-hyderabadi-gravy-half",
    "name": "Chicken Hyderabadi Gravy (Half)",
    "category": "chicken-gravy",
    "categoryName": "Chicken Gravies",
    "price": 179,
    "image": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Half plate Hyderabadi style chicken gravy.",
    "inStock": true
  },
  {
    "id": "dish-ceylon-parota",
    "name": "Ceylon Parota",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 40,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Layered",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Crispy, flaky square layered parota rolled and pan-fried.",
    "inStock": true
  },
  {
    "id": "dish-kerala-parota",
    "name": "Kerala Parota",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 40,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Malabar",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Traditional Malabar layered flaky flatbread, soft inside and crisp outside.",
    "inStock": true
  },
  {
    "id": "dish-roomali-roti",
    "name": "Roomali Roti",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 40,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Handkerchief Soft",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Ultra thin, soft flatbread stretched and cooked over an inverted wok.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-roti",
    "name": "Tandoori Roti",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 45,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Whole Wheat",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Whole wheat bread baked crisp on clay tandoor walls.",
    "inStock": true
  },
  {
    "id": "dish-tandoori-butter-roti",
    "name": "Tandoori Butter Roti",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 54,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Buttery",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Hot tandoori wheat roti brushed generously with melted butter.",
    "inStock": true
  },
  {
    "id": "dish-butter-kulcha",
    "name": "Butter Kulcha",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 55,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Soft",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Soft leavened flatbread topped with black sesame and melted butter.",
    "inStock": true
  },
  {
    "id": "dish-kulcha",
    "name": "Kulcha",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 50,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Classic oven-baked leavened bread.",
    "inStock": true
  },
  {
    "id": "dish-butter-naan",
    "name": "Butter Naan",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 50,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Favorite",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Pillow-soft tandoori naan glazed with rich melted dairy butter.",
    "inStock": true
  },
  {
    "id": "dish-naan",
    "name": "Naan",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 45,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Plain",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Traditional clay-oven baked plain naan.",
    "inStock": true
  },
  {
    "id": "dish-garlic-naan",
    "name": "Garlic Naan",
    "category": "roti-items",
    "categoryName": "Roti & Breads",
    "price": 50,
    "image": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80",
    "badge": "Garlic Butter",
    "time": "5 - 8 mins",
    "diet": "Veg",
    "desc": "Tandoori naan infused with minced garlic and coriander, topped with butter.",
    "inStock": true
  },
  {
    "id": "dish-shawarma-special-roll",
    "name": "Shawarma Special Roll (Starts 5 PM)",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 150,
    "image": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80",
    "badge": "🔥 Loaded (Starts 5 PM)",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Loaded with extra shredded rotisserie chicken, garlic toum, pickles, and french fries.",
    "inStock": true
  },
  {
    "id": "dish-shawarma-roll",
    "name": "Shawarma Roll (Starts 5 PM)",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 130,
    "image": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Classic (Starts 5 PM)",
    "time": "8 - 10 mins",
    "diet": "Non-Veg",
    "desc": "Juicy Arabian chicken shawarma wrapped in warm rumali with creamy garlic sauce.",
    "inStock": true
  },
  {
    "id": "dish-shawarma-plate",
    "name": "Shawarma Plate (Starts 5 PM)",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80",
    "badge": "Platter (Starts 5 PM)",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Generous mound of rotisserie chicken shavings served with rumali roti, fries, salad, and garlic sauce.",
    "inStock": true
  },
  {
    "id": "dish-jumbo-shawarma",
    "name": "Jumbo Shawarma (Starts 5 PM)",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 199,
    "image": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80",
    "badge": "XL Size (Starts 5 PM)",
    "time": "10 - 12 mins",
    "diet": "Non-Veg",
    "desc": "Extra large double-wrapped chicken shawarma with cheese and special dressing.",
    "inStock": true
  },
  {
    "id": "dish-veg-noodles",
    "name": "Veg Noodles",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 155,
    "image": "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80",
    "badge": "Wok Tossed",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Hakka noodles wok-tossed with shredded cabbage, carrots, bell peppers, and soy.",
    "inStock": true
  },
  {
    "id": "dish-chicken-noodles",
    "name": "Chicken Noodles",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 195,
    "image": "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80",
    "badge": "Popular",
    "time": "12 - 15 mins",
    "diet": "Non-Veg",
    "desc": "Stir-fried noodles loaded with shredded tender chicken and vegetables.",
    "inStock": true
  },
  {
    "id": "dish-egg-noodles",
    "name": "Egg Noodles",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 175,
    "image": "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Egg",
    "desc": "Wok-fried noodles with scrambled egg ribbons and fresh green onions.",
    "inStock": true
  },
  {
    "id": "dish-chicken-samosa",
    "name": "Chicken Samosa",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 30,
    "image": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80",
    "badge": "Snack",
    "time": "5 mins",
    "diet": "Non-Veg",
    "desc": "Crispy triangular pastry stuffed with spicy minced chicken filling.",
    "inStock": true
  },
  {
    "id": "dish-veg-samosa",
    "name": "Veg Samosa",
    "category": "shawarma-rolls",
    "categoryName": "Shawarma & Rolls",
    "price": 30,
    "image": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80",
    "badge": "Snack",
    "time": "5 mins",
    "diet": "Veg",
    "desc": "Golden crust samosa filled with spiced potato and green peas mash.",
    "inStock": true
  },
  {
    "id": "dish-paneer-butter-masala",
    "name": "Paneer Butter Masala",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Veg Best",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Soft cottage cheese cubes in a creamy, velvety tomato and butter makhani gravy.",
    "inStock": true
  },
  {
    "id": "dish-palak-paneer",
    "name": "Palak Paneer",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1613292443284-8d10ef9383fe?w=500&auto=format&fit=crop&q=80",
    "badge": "Healthy",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Fresh cottage cheese simmered in a spiced spinach puree with garlic and ginger.",
    "inStock": true
  },
  {
    "id": "dish-paneer-65",
    "name": "Paneer 65",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "Crispy",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Crispy batter-fried paneer cubes tossed with curry leaves, curd, and red chillies.",
    "inStock": true
  },
  {
    "id": "dish-paneer-pepper-dry",
    "name": "Paneer Pepper Dry",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "Peppery",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Cottage cheese pieces sautéed with crushed black pepper, onions, and curry leaves.",
    "inStock": true
  },
  {
    "id": "dish-chilli-paneer",
    "name": "Chilli Paneer",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80",
    "badge": "Indo-Chinese",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Wok-fried paneer cubes in spicy dark soy sauce with crunchy green peppers.",
    "inStock": true
  },
  {
    "id": "dish-kaddi-paneer",
    "name": "Kadai Paneer",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "Wok Special",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Paneer cubes cooked with freshly pounded kadai coriander spices, capsicum, and tomato.",
    "inStock": true
  },
  {
    "id": "dish-paneer-manchurian",
    "name": "Paneer Manchurian",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Crispy paneer tossed in ginger, garlic, spring onion, and tangy soya Manchurian glaze.",
    "inStock": true
  },
  {
    "id": "dish-mushroom-masala",
    "name": "Mushroom Masala",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Fresh button mushrooms simmered in a spiced onion, tomato, and cashew gravy.",
    "inStock": true
  },
  {
    "id": "dish-mushroom-manchurian",
    "name": "Mushroom Manchurian",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Crispy batter-fried button mushrooms glazed with savoury Manchurian sauce.",
    "inStock": true
  },
  {
    "id": "dish-mushroom-pepper-dry",
    "name": "Mushroom Pepper Dry",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "Dry",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Sliced mushrooms tossed in spicy crushed black pepper and caramelised onions.",
    "inStock": true
  },
  {
    "id": "dish-mushroom-chilli",
    "name": "Mushroom Chilli",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "Spicy",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Wok-tossed mushrooms with green chillies, garlic, and capsicum.",
    "inStock": true
  },
  {
    "id": "dish-green-piece-masala",
    "name": "Green Peas Masala",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Sweet green peas cooked in a rich, velvety spiced tomato and onion gravy.",
    "inStock": true
  },
  {
    "id": "dish-alu-goobi-masala",
    "name": "Alu Gobi Masala",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=500&auto=format&fit=crop&q=80",
    "badge": "Dhaba Classic",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Tender potatoes and fresh cauliflower florets sauteed with cumin, ginger, and turmeric.",
    "inStock": true
  },
  {
    "id": "dish-baby-corn-masala",
    "name": "Baby Corn Masala",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Crispy baby corn chunks simmered in aromatic North Indian spiced curry.",
    "inStock": true
  },
  {
    "id": "dish-veg-khurma",
    "name": "Veg Kurma",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Assorted vegetables simmered in rich coconut, poppy seeds, and cashew gravy.",
    "inStock": true
  },
  {
    "id": "dish-kadai-veg",
    "name": "Kadai Veg",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 190,
    "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80",
    "badge": "",
    "time": "12 - 15 mins",
    "diet": "Veg",
    "desc": "Mixed garden vegetables cooked in spicy kadai gravy with bell peppers.",
    "inStock": true
  },
  {
    "id": "dish-dal-fry",
    "name": "Dal Fry",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "Comfort Food",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Yellow toor dal tempered with cumin, garlic, green chillies, and tomatoes in desi ghee.",
    "inStock": true
  },
  {
    "id": "dish-dal-tadaka",
    "name": "Dal Tadka",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 140,
    "image": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80",
    "badge": "⭐ Ghee Tadka",
    "time": "10 - 12 mins",
    "diet": "Veg",
    "desc": "Golden lentils topped with aromatic sizzling ghee tadka of mustard seeds and dried red chillies.",
    "inStock": true
  },
  {
    "id": "dish-tomato-fry",
    "name": "Tomato Fry",
    "category": "veg-gravy",
    "categoryName": "Veg Gravy & Dal",
    "price": 120,
    "image": "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=500&auto=format&fit=crop&q=80",
    "badge": "Tangy",
    "time": "8 - 10 mins",
    "diet": "Veg",
    "desc": "Fresh country tomatoes cooked with mustard seeds, curry leaves, onions, and spices.",
    "inStock": true
  }
];

// Available food images for quick selection in Admin
export const PRESET_FOOD_IMAGES = [
  {
    "name": "Hyderabadi Dum Biryani",
    "path": "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Royal Mutton Biryani",
    "path": "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Arabian Mandi Platter",
    "path": "https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Tandoori Mandi Feast",
    "path": "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Al-Faham Charcoal Mandi",
    "path": "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Tandoori Chicken Clay Oven",
    "path": "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Chicken Tikka Skewers",
    "path": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Creamy Malai Tikka",
    "path": "https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Spicy Chicken 65",
    "path": "https://images.unsplash.com/photo-1625938145744-e380515399b7?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Chilli Chicken Dry",
    "path": "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Crispy Chicken Lollipop",
    "path": "https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Savera Butter Chicken Gravy",
    "path": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Kadai Chicken Masala",
    "path": "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Butter Naan Tandoori",
    "path": "https://images.unsplash.com/photo-1626074353765-517a681e40be?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Malabar Flaky Parota",
    "path": "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Hot & Sour Soup",
    "path": "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=500&auto=format&fit=crop&q=80"
  },
  {
    "name": "Sweet Corn Soup Bowl",
    "path": "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=500&auto=format&fit=crop&q=80"
  }
];

/**
 * Sanitizes dish image URLs to ensure they never expire.
 * Converts any legacy Cloudflare R2 presigned URLs to permanent proxy endpoints.
 */
export function sanitizeDishImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('r2.cloudflarestorage.com') && url.includes('dishes/')) {
    const match = url.match(/dishes\/([^?&#]+)/);
    if (match && match[1]) {
      return `/api/r2-image?key=dishes/${decodeURIComponent(match[1])}`;
    }
  }
  return url;
}

/**
 * Sanitizes category image URLs to ensure they never expire.
 * Converts Cloudflare R2 presigned URLs, relative keys, and raw filenames to permanent proxy endpoints.
 */
export function sanitizeCategoryImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // 1. Direct R2 presigned URLs: convert to permanent proxy endpoint
  if (trimmed.includes('r2.cloudflarestorage.com')) {
    const match = trimmed.match(/(categories|dishes)\/([^?&#]+)/);
    if (match && match[1] && match[2]) {
      return `/api/r2-image?key=${encodeURIComponent(`${match[1]}/${decodeURIComponent(match[2])}`)}`;
    }
  }

  // 2. Relative keys
  if (trimmed.startsWith('categories/') || trimmed.startsWith('dishes/')) {
    return `/api/r2-image?key=${encodeURIComponent(trimmed)}`;
  }

  // 3. User uploaded category image root filename
  if (trimmed.startsWith('category_') || trimmed.startsWith('Gemini_Generated_Image_')) {
    return `/api/r2-image?key=${encodeURIComponent(`categories/${trimmed}`)}`;
  }

  return trimmed;
}

/**
 * Multi-tier customer phone extractor:
 * Reads from order fields, embedded address tags [Phone: ...], customer name, or matched user addresses
 */
export function extractPhoneFromOrder(o, rawAddrs = []) {
  if (!o) return '';
  const candidates = [
    o.customerPhone,
    o.customer_phone,
    o.phone,
    o.userPhone,
    o.addressDetails?.phone,
    o.addressDetails?.customerPhone
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.replace(/\D/g, '').length >= 10) {
      return c.trim();
    }
    if (typeof c === 'number' && String(c).length >= 10) {
      return String(c);
    }
  }

  // Extract from deliveryAddress if embedded e.g. "[Phone: 9845123456]" or "📞 9845123456"
  const addrStr = o.deliveryAddress || '';
  const phoneMatch = addrStr.match(/\[Phone:\s*([+0-9\s-]+)\]/i) ||
                     addrStr.match(/📞\s*([+0-9\s-]+)/) ||
                     addrStr.match(/(?:Phone|Mobile|Contact):\s*([+0-9\s-]+)/i) ||
                     addrStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) {
    const rawMatch = phoneMatch[1] || phoneMatch[0];
    const cleanDigits = rawMatch.replace(/\D/g, '');
    if (cleanDigits.length >= 10) {
      return rawMatch.trim();
    }
  }

  // Extract from customerName if embedded e.g. "Syed Hamza | 9845123456"
  const nameStr = o.customerName || o.customer_name || '';
  const namePhoneMatch = nameStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
  if (namePhoneMatch) {
    return namePhoneMatch[0].trim();
  }

  // Match with saved user addresses in rawAddrs
  if (Array.isArray(rawAddrs) && rawAddrs.length > 0) {
    const matched = rawAddrs.find(a => 
      (a.phone && o.userId && a.userId === o.userId) ||
      (a.phone && a.userEmail && o.customerEmail && a.userEmail.toLowerCase() === o.customerEmail.toLowerCase()) ||
      (a.phone && a.name && (o.customerName || o.customer_name) && a.name.trim().toLowerCase() === (o.customerName || o.customer_name).trim().toLowerCase()) ||
      (a.phone && a.flatNo && addrStr && addrStr.includes(a.flatNo)) ||
      (a.phone && a.area && addrStr && addrStr.includes(a.area))
    );
    if (matched && matched.phone && String(matched.phone).replace(/\D/g, '').length >= 10) {
      return String(matched.phone).trim();
    }
  }

  return '';
}

/**
 * Strips technical metadata tags like [Phone: ...] from the address string
 * for pristine user and rider display
 */
export function cleanDeliveryAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'Doorstep Delivery';
  return addr
    .replace(/\[Phone:\s*[^\]]+\]/gi, '')
    .replace(/📞\s*[+0-9\s-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ========================================================
// DATA ACCESS LAYER (LocalStorage + Live Supabase Sync)
// ========================================================
class QuickBiteDataService {
  constructor() {
    this.isSupabaseConnected = false;
    this.realtimeChannel = null;
    this.heartbeatTimer = null;
    this.dishesCache = null;
    this.uploadedImagesCache = null;
    let path = '';
    if (typeof window !== 'undefined' && window.location) {
      path = window.location.pathname.toLowerCase();
    }
    this.portalType = path.includes('admin') ? 'admin' : (path.includes('delivery') ? 'delivery' : 'customer');

    // Memory Caches & In-Flight Request Deduplication to prevent excessive Supabase egress
    this._isSyncingCategories = null;
    this._lastCategoriesSyncTime = 0;
    this._isSyncingDishes = null;
    this._lastDishesSyncTime = 0;
    this._isSyncingSettings = null;
    this._lastSettingsSyncTime = 0;
    this._isSyncingOrders = null;
    this._lastOrdersSyncTime = 0;
    this._isSyncingCustomerOrders = null;
    this._lastCustomerOrdersSyncTime = 0;

    // Persistent cross-tab broadcast channel & cross-device shared realtime channel
    this.syncBroadcastChannel = null;
    this.sharedBroadcastChannel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined') {
        this.syncBroadcastChannel = new BroadcastChannel('quickbite_sync_channel');
        this.syncBroadcastChannel.onmessage = (event) => {
          const data = event.data;
          if (data && data.type) {
            window.dispatchEvent(new CustomEvent('quickbite_data_changed', { detail: data }));
          }
        };
      }
    } catch {}

    try {
      if (typeof localStorage !== 'undefined' && typeof window !== 'undefined') {
        this.init();
        this.initSupabase();
        this.startLiveHeartbeat();
      }
    } catch (err) {
      console.warn('[DataService] constructor error fallback:', err);
    }
  }

  init() {
    try {
      // 1. Synchronously populate dishesCache and uploadedImagesCache from localStorage
      const storedDishes = localStorage.getItem(STORAGE_KEYS.DISHES);
      if (storedDishes) {
        try {
          this.dishesCache = JSON.parse(storedDishes);
        } catch {
          this.dishesCache = null;
        }
      }

      const storedUploads = localStorage.getItem(STORAGE_KEYS.UPLOADED_IMAGES);
      if (storedUploads) {
        try {
          this.uploadedImagesCache = JSON.parse(storedUploads);
        } catch {
          this.uploadedImagesCache = null;
        }
      }

      const MENU_VERSION = 'savera_paradise_v5_authentic_fullmenu';
      const storedVersion = localStorage.getItem('cryspy_menu_version');

      const hasOldDishes = (this.dishesCache || []).some(d => d.id && (
        d.id.startsWith('dish-chicken-1pc') || 
        d.id.startsWith('dish-chicken-3pcs') || 
        d.id.startsWith('dish-strips-') || 
        d.id.startsWith('dish-combo-') || 
        d.id.startsWith('dish-burger-') || 
        d.id.startsWith('dish-pizza-') || 
        d.id.startsWith('dish-sandwich-') || 
        d.id.startsWith('dish-bites-') || 
        d.id.startsWith('dish-fries-') || 
        d.id.startsWith('dish-momos-') || 
        d.id.startsWith('dish-roll-') ||
        d.id.startsWith('dish-chicken-hyd-biryani') ||
        d.id.startsWith('dish-mutton-') ||
        d.id.startsWith('dish-grill-mandi') ||
        d.id.startsWith('dish-tandoori-chick-half')
      ));

      if (!this.dishesCache || this.dishesCache.length === 0 || storedVersion !== MENU_VERSION || hasOldDishes) {
        // Upgrade menu version to Savera Paradise authentic menu
        const oldDefaultPrefixes = ['dish-chicken-1pc', 'dish-chicken-3pcs', 'dish-chicken-6pcs', 'dish-strips-', 'dish-combo-', 'dish-burger-', 'dish-pizza-', 'dish-sandwich-', 'dish-bites-', 'dish-fries-', 'dish-momos-', 'dish-roll-'];
        const customDishes = (this.dishesCache || []).filter(d => 
          d.id && !oldDefaultPrefixes.some(p => d.id.startsWith(p)) && !DEFAULT_DISHES.some(nd => nd.id === d.id)
        );

        this.dishesCache = [...DEFAULT_DISHES, ...customDishes];
        try {
          localStorage.setItem(STORAGE_KEYS.DISHES, JSON.stringify(this.dishesCache));
          localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(DEFAULT_CATEGORIES));
          idbSet('dishes', this.dishesCache).catch(() => {});
        } catch {}
        localStorage.setItem('cryspy_menu_version', MENU_VERSION);
      }

      if (!localStorage.getItem(STORAGE_KEYS.CATEGORIES)) {
        localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(DEFAULT_CATEGORIES));
      }

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!storedSettings) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
      } else {
        try {
          const s = JSON.parse(storedSettings);
          if (s.deliveryFeeStandard && s.deliveryFeeStandard < 10) {
            s.deliveryFeeStandard = 40;
          }
          if (s.offerTitle && (s.offerTitle.includes('SMM') || s.offerTitle.includes('Cryspy'))) {
            s.offerTitle = s.offerTitle.replace(/SMM Taj|SMM/gi, 'Savera');
          }
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
        } catch {}
      }
      if (!localStorage.getItem(STORAGE_KEYS.ORDERS)) {
        localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(DEFAULT_ORDERS));
      }

      // Populate uploaded images gallery from existing dish photos if any
      this.populateUploadedImagesFromDishes();

      // Asynchronously hydrate from IndexedDB (source of truth for large images)
      this.hydrateFromIndexedDB();
    } catch (e) {
      console.warn('[DataService] LocalStorage initialization error fallback:', e);
    }
  }

  async hydrateFromIndexedDB() {
    try {
      const idbDishes = await idbGet('dishes');
      if (Array.isArray(idbDishes) && idbDishes.length > 0) {
        const idbHasOld = idbDishes.some(d => d.id && (d.id.startsWith('dish-chicken-1pc') || d.id.startsWith('dish-strips-') || d.id.startsWith('dish-burger-')));
        if (idbHasOld) {
          // Clear legacy dishes from IndexedDB and sync fresh Savera Paradise dishes
          await idbSet('dishes', this.dishesCache);
        } else if (!this.dishesCache || this.dishesCache.length === 0) {
          this.dishesCache = idbDishes;
          this.notifyChange('dishes');
        } else {
          // Merge custom uploaded images from IndexedDB only if local dish has no image
          let hasNewImage = false;
          const merged = this.dishesCache.map(d => {
            const fromIdb = idbDishes.find(x => x.id === d.id);
            if (fromIdb && fromIdb.image) {
              const hasRemoteR2Image = d.image && (d.image.includes('/api/r2-image') || d.image.startsWith('http'));
              // NEVER overwrite a valid Cloudflare R2 URL or remote image with a local Base64 string!
              if (!hasRemoteR2Image && !fromIdb.image.startsWith('data:') && fromIdb.image.startsWith('http')) {
                hasNewImage = true;
                return { ...d, image: fromIdb.image };
              }
            }
            return d;
          });
          if (hasNewImage) {
            this.dishesCache = merged;
            this.notifyChange('dishes');
          }
        }
      }

      const idbUploads = await idbGet('uploaded_images');
      if (Array.isArray(idbUploads) && idbUploads.length > 0) {
        this.uploadedImagesCache = idbUploads;
        this.notifyChange('uploaded_images');
      }
      this.populateUploadedImagesFromDishes();
    } catch (err) {
      console.warn('[DataService] hydrateFromIndexedDB error:', err);
    }
  }

  populateUploadedImagesFromDishes() {
    try {
      const dishes = this.getDishes();
      const currentUploads = this.getUploadedImages();
      const existingUrls = new Set(currentUploads.map(u => u.url));
      let added = false;
      dishes.forEach(d => {
        if (d.image && (d.image.startsWith('data:') || d.image.includes('lh3.googleusercontent.com') || (d.image.startsWith('http') && !d.image.includes('unsplash')))) {
          if (!existingUrls.has(d.image)) {
            currentUploads.push({
              id: 'upload-' + (d.id || Date.now()),
              url: d.image,
              name: d.name || 'Custom Upload',
              uploadedAt: Date.now()
            });
            existingUrls.add(d.image);
            added = true;
          }
        }
      });
      if (added) {
        this.uploadedImagesCache = currentUploads.slice(0, 50);
        idbSet('uploaded_images', this.uploadedImagesCache).catch(() => {});
      }
    } catch {}
  }

  async initSupabase() {
    try {
      // Initial Sync from Supabase tables
      await this.syncAllFromSupabase();

      // Listen for live Realtime broadcast changes
      this.setupRealtime();
    } catch (err) {
      console.warn('[QuickBite] Supabase offline fallback active:', err?.message || err);
    }
  }

  async syncCategoryImagesFromSupabase() {
    try {
      if (!supabase) return this.getCategoryImages();
      const { data, error } = await supabase
        .from('store_settings')
        .select('*')
        .eq('id', 'category_images')
        .maybeSingle();

      if (!error && data && data.settings && typeof data.settings === 'object') {
        const localMap = this.getCategoryImages();
        const merged = { ...data.settings, ...localMap };
        localStorage.setItem(STORAGE_KEYS.CATEGORY_IMAGES, JSON.stringify(merged));
        return merged;
      }
    } catch (e) {
      console.warn('[DataService] syncCategoryImagesFromSupabase error:', e);
    }
    return this.getCategoryImages();
  }

  async syncAllFromSupabase() {
    const syncTasks = [
      this.syncCategoryImagesFromSupabase(),
      this.syncCategoriesFromSupabase(),
      this.syncDishesFromSupabase(),
      this.syncSettingsFromSupabase()
    ];
    // PRIVACY GUARD: Only staff portals (Admin & Delivery) may sync all restaurant orders.
    // Customers only sync their own orders via syncCustomerOrdersFromSupabase().
    if (this.portalType === 'admin' || this.portalType === 'delivery') {
      syncTasks.push(this.syncOrdersFromSupabase());
      syncTasks.push(this.syncRidersFromSupabase());
    }
    await Promise.allSettled(syncTasks);
  }

  async syncCategoriesFromSupabase(force = false) {
    if (!force && Date.now() - this._lastCategoriesSyncTime < 120000 && this.getCategories().length > 0) {
      return this.getCategories();
    }
    if (this._isSyncingCategories) return this._isSyncingCategories;

    this._isSyncingCategories = (async () => {
      try {
        await this.syncCategoryImagesFromSupabase();
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .order('created_at', { ascending: true });

        if (!error && data && data.length > 0) {
          const hasLegacy = data.some(c => c.id === 'cat-chicken' || c.id === 'cat-strips' || c.id === 'cat-burger');
          if (hasLegacy) {
            console.warn('[DataService] Skipping legacy remote categories in sync.');
            return;
          }
          const customImages = this.getCategoryImages();
          const merged = data.map(remoteCat => {
            const customImg = (customImages[remoteCat.id] || (remoteCat.slug ? customImages[remoteCat.slug] : '') || remoteCat.image || '').trim();
            const existingImg = sanitizeCategoryImageUrl(customImg);
            return {
              ...remoteCat,
              image: existingImg
            };
          });
          localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(merged));
          this.notifyChange('categories');
          this.isSupabaseConnected = true;
          this._lastCategoriesSyncTime = Date.now();
        }
      } catch (e) {
        // Tables may not be created yet in Supabase
      }
    })().finally(() => {
      this._isSyncingCategories = null;
    });

    return this._isSyncingCategories;
  }

  async syncDishesFromSupabase(force = false) {
    if (!force && Date.now() - this._lastDishesSyncTime < 120000 && this.getDishes().length > 0) {
      return this.getDishes();
    }
    if (this._isSyncingDishes) return this._isSyncingDishes;

    this._isSyncingDishes = (async () => {
      try {
        const { data, error } = await supabase
          .from('dishes')
          .select('*')
          .order('created_at', { ascending: true });

        if (!error && data && data.length > 0) {
          const hasLegacy = data.some(d => d.id && (d.id.startsWith('dish-chicken-1pc') || d.id.startsWith('dish-strips-') || d.id.startsWith('dish-burger-')));
          if (hasLegacy) {
            console.warn('[DataService] Skipping legacy remote dishes in sync.');
            return;
          }

          const mapped = data.map(d => {
            const finalImage = d.image || 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&auto=format&fit=crop&q=80';
            return {
              id: d.id,
              name: d.name,
              category: d.category,
              categoryName: d.category_name,
              price: parseFloat(d.price) || 0,
              rating: '',
              image: finalImage,
              badge: d.badge || '',
              time: d.time || '10 - 15 mins',
              calories: d.calories || '',
              diet: d.diet || '',
              desc: d.description || d.desc || '',
              inStock: d.in_stock !== false
            };
          });

          this.saveDishes(mapped);
          this.populateUploadedImagesFromDishes();
          this.isSupabaseConnected = true;
          this._lastDishesSyncTime = Date.now();
        }
      } catch (e) {
        console.warn('[DataService] syncDishesFromSupabase error:', e);
      }
    })().finally(() => {
      this._isSyncingDishes = null;
    });

    return this._isSyncingDishes;
  }

  async syncOrdersFromSupabase(force = false) {
    if (!force && Date.now() - this._lastOrdersSyncTime < 4000) {
      return this.getOrders();
    }
    if (this._isSyncingOrders) return this._isSyncingOrders;

    this._isSyncingOrders = (async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(60);

        if (!error && Array.isArray(data)) {
          this._lastOrdersSyncTime = Date.now();
          if (data.length === 0) {
            this.isSupabaseConnected = true;
            const currentLocal = this.getOrders();
            if (currentLocal.length > 0) {
              console.log('[Supabase] syncOrders: remote database has 0 orders, clearing local cache for fresh restaurant handover');
              localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify([]));
              try {
                localStorage.removeItem('quickbite_my_order_ids');
                localStorage.removeItem('quickbite_order_status_sync');
                localStorage.removeItem('quickbite_acknowledged_alarms');
                localStorage.removeItem('quickbite_last_notified_order');
              } catch {}
              this.notifyChange('orders', { action: 'orders_cleared' });
            }
            return;
          }

          const localList = this.getOrders();
          const rawAddrs = this.getAllAddressesRaw();
          const normalizeId = (id) => String(id || '').trim().replace(/^#/, '');
          let hasChanges = false;
          const newOrdersToNotify = [];
          const updatedOrdersToNotify = [];

          data.forEach(remote => {
            const remoteCleanId = normalizeId(remote.id);
            const localIdx = localList.findIndex(l => l && normalizeId(l.id) === remoteCleanId);
            const local = localIdx !== -1 ? localList[localIdx] : null;

            const recoveredPhone = extractPhoneFromOrder(remote, rawAddrs) || local?.customerPhone || '';
            const digits = String(remote.id || '').replace(/\D/g, '');
            const fallbackPickupCode = digits.length >= 4 ? digits.slice(-4) : (digits || '1001');

            // Database is the authoritative Single Source of Truth with Monotonic Rank Guard
            const remoteRank = remote.status && ORDER_STATUS_RANKS[remote.status] !== undefined ? ORDER_STATUS_RANKS[remote.status] : -1;
            const localRank = local?.status && ORDER_STATUS_RANKS[local.status] !== undefined ? ORDER_STATUS_RANKS[local.status] : -1;
            let effectiveStatus = remote.status || local?.status || 'accepted';
            if (remote.status !== 'cancelled' && localRank > remoteRank) {
              effectiveStatus = local.status;
            }
            const effectiveStepIndex = typeof remote.step_index === 'number'
              ? remote.step_index
              : (ORDER_STATUS_RANKS[effectiveStatus] !== undefined ? ORDER_STATUS_RANKS[effectiveStatus] : (local?.stepIndex || 0));
            const effectiveStatusLabel = remote.status_label || local?.statusLabel || 'Accepted';
            const effectiveEta = remote.eta || local?.eta || '20 - 30 Minutes';

            const mergedOrder = {
              ...(local || {}),
              id: remote.id || local?.id,
              createdAt: Number(remote.created_at) || local?.createdAt || Date.now(),
              userId: remote.user_id || local?.userId || null,
              customerName: remote.customer_name || local?.customerName || 'Online Guest',
              customerEmail: remote.customer_email || local?.customerEmail || '',
              customerPhone: remote.customer_phone || recoveredPhone || local?.customerPhone || '',
              phone: remote.customer_phone || recoveredPhone || local?.customerPhone || '',
              customer_phone: remote.customer_phone || recoveredPhone || local?.customerPhone || '',
              deliveryAddress: remote.delivery_address || local?.deliveryAddress || 'Express Delivery',
              stepIndex: effectiveStepIndex,
              status: effectiveStatus,
              statusLabel: effectiveStatusLabel,
              eta: effectiveEta,
              itemsSummary: remote.items_summary || local?.itemsSummary || '',
              items: remote.items || local?.items || [],
              total: remote.total || local?.total || '$0.00',
              paymentMethod: remote.payment_method || local?.paymentMethod || 'Cash on Delivery (COD)',
              paymentStatus: remote.payment_status || local?.paymentStatus || 'Cash on Delivery',
              lat: remote.lat ? Number(remote.lat) : (local?.lat || local?.addressDetails?.lat || null),
              lng: remote.lng ? Number(remote.lng) : (local?.lng || local?.addressDetails?.lng || null),
              addressDetails: remote.address_details || local?.addressDetails || null,
              pickupCode: remote.pickup_code || local?.pickupCode || fallbackPickupCode,
              assignedRiderPin: remote.assigned_rider_pin || local?.assignedRiderPin || null,
              assignedRiderName: remote.assigned_rider_name || local?.assignedRiderName || null,
              assignedRiderPhone: remote.assigned_rider_phone || local?.assignedRiderPhone || null,
              assignedRiderVehicle: remote.assigned_rider_vehicle || local?.assignedRiderVehicle || null,
              claimedAt: remote.claimed_at ? Number(remote.claimed_at) : (local?.claimedAt || null),
              cancellationReason: remote.cancellation_reason || local?.cancellationReason || null,
              trackingToken: remote.tracking_token || local?.trackingToken || null,
              alarmAcknowledged: local?.alarmAcknowledged || false,
              alarmStoppedAt: local?.alarmStoppedAt || null
            };

            if (remote.tracking_token) {
              try {
                const tokens = JSON.parse(localStorage.getItem('quickbite_tracking_tokens') || '{}');
                tokens[remote.id] = remote.tracking_token;
                localStorage.setItem('quickbite_tracking_tokens', JSON.stringify(tokens));
              } catch {}
            }

            if (localIdx !== -1) {
              const hasDifference = local.status !== effectiveStatus ||
                                    local.eta !== effectiveEta ||
                                    local.stepIndex !== effectiveStepIndex ||
                                    local.assignedRiderPin !== mergedOrder.assignedRiderPin ||
                                    local.assignedRiderName !== mergedOrder.assignedRiderName;
              localList[localIdx] = mergedOrder;
              if (hasDifference) {
                const prevStatus = local.status;
                hasChanges = true;
                updatedOrdersToNotify.push({ order: mergedOrder, prevStatus });
              }
            } else {
              localList.unshift(mergedOrder);
              hasChanges = true;
              newOrdersToNotify.push(mergedOrder);
            }
          });

          // Clean up any stale ghost orders that no longer exist in Supabase
          const remoteCleanIds = new Set(data.map(r => normalizeId(r.id)));
          const prunedList = localList.filter(o => {
            if (!o || !o.id) return false;
            const cId = normalizeId(o.id);
            if (remoteCleanIds.has(cId)) return true;
            if (o.status && o.status !== 'delivered' && o.status !== 'cancelled') return true;
            const age = Date.now() - (Number(o.createdAt) || 0);
            return age < 2 * 60 * 1000;
          });
          if (prunedList.length !== localList.length) {
            hasChanges = true;
            localList.length = 0;
            localList.push(...prunedList);
          }

          if (hasChanges) {
            localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(localList));

            newOrdersToNotify.forEach(no => {
              if ((no.status || 'accepted') === 'accepted' || no.status === 'pending') {
                this.notifyChange('orders', { action: 'new_order', order: no, source: 'supabase' });
              } else {
                this.notifyChange('orders', { action: 'status_updated', orderId: no.id, order: no, source: 'supabase' });
              }
            });

            updatedOrdersToNotify.forEach(({ order, prevStatus }) => {
              this.notifyChange('orders', { action: 'status_updated', orderId: order.id, order, prevStatus, source: 'supabase' });
            });
          }

          this.isSupabaseConnected = true;
        }
      } catch (e) {
        // Tables may not be created yet
      }
    })().finally(() => {
      this._isSyncingOrders = null;
    });

    return this._isSyncingOrders;
  }

  setupRealtime() {
    if (this.isSubscribingRealtime) return;
    this.isSubscribingRealtime = true;

    try {
      if (this.realtimeChannel) {
        try {
          supabase.removeChannel(this.realtimeChannel);
        } catch {}
        this.realtimeChannel = null;
      }

      let _ordersDebounceTimer = null;
      let _dishesDebounceTimer = null;
      let _categoriesDebounceTimer = null;
      let _settingsDebounceTimer = null;

      const channelName = `quickbite-realtime-${this.portalType}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
          if (_categoriesDebounceTimer) clearTimeout(_categoriesDebounceTimer);
          _categoriesDebounceTimer = setTimeout(() => this.syncCategoriesFromSupabase(true), 500);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => {
          if (_dishesDebounceTimer) clearTimeout(_dishesDebounceTimer);
          _dishesDebounceTimer = setTimeout(() => this.syncDishesFromSupabase(true), 500);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
          if (_ordersDebounceTimer) clearTimeout(_ordersDebounceTimer);
          _ordersDebounceTimer = setTimeout(() => {
            if (this.portalType === 'admin' || this.portalType === 'delivery') {
              this.syncOrdersFromSupabase(true);
            } else {
              this.syncCustomerActiveOrders();
            }
          }, 400);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, (payload) => {
          if (payload && payload.new && payload.new.id === 'category_images') {
            this.syncCategoryImagesFromSupabase().then(() => {
              this.notifyChange('categories');
            });
          } else {
            if (_settingsDebounceTimer) clearTimeout(_settingsDebounceTimer);
            _settingsDebounceTimer = setTimeout(() => this.syncSettingsFromSupabase(true), 500);
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_addresses' }, () => {
          this.notifyChange('addresses');
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, () => {
          if (this.portalType === 'admin' || this.portalType === 'delivery') {
            this.syncRidersFromSupabase();
          }
        });

      channel.subscribe((status, err) => {
        this.isSubscribingRealtime = false;
        if (status === 'SUBSCRIBED') {
          this.isSupabaseConnected = true;
          console.log('[DataService] Supabase Realtime connected successfully.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[DataService] Supabase Realtime channel error:', status, err);
          setTimeout(() => {
            if (typeof document !== 'undefined' && !document.hidden) {
              this.setupRealtime();
            }
          }, 5000);
        }
      });

      this.realtimeChannel = channel;

      // Shared Cross-Device Kitchen Broadcast Channel (Instant Stop Alarm across 2 or more devices)
      if (this.sharedBroadcastChannel) {
        try {
          supabase.removeChannel(this.sharedBroadcastChannel);
        } catch {}
        this.sharedBroadcastChannel = null;
      }

      this.sharedBroadcastChannel = supabase.channel('quickbite-kitchen-broadcast', {
        config: { broadcast: { self: false } }
      });

      this.sharedBroadcastChannel
        .on('broadcast', { event: 'stop_alarm' }, (event) => {
          const payload = event?.payload || {};
          console.log('[Supabase Realtime] Received cross-device stop_alarm broadcast:', payload);
          // 1. Immediately acknowledge orders locally so subsequent scans never re-trigger alarm
          try {
            const orders = this.getOrders();
            let changed = false;
            const targetIds = Array.isArray(payload.orderIds) && payload.orderIds.length > 0
              ? payload.orderIds
              : orders.filter(o => (o.status === 'accepted' || o.status === 'pending') && !o.alarmAcknowledged).map(o => o.id);

            targetIds.forEach(id => {
              const o = orders.find(ord => ord.id === id);
              if (o && !o.alarmAcknowledged) {
                o.alarmAcknowledged = true;
                o.alarmStoppedAt = payload.timestamp || Date.now();
                changed = true;
              }
            });
            if (changed) {
              this.saveOrders(orders, { action: 'alarm_acknowledged_remote' });
            }
          } catch (err) {
            console.warn('[DataService] Error acknowledging orders locally on remote broadcast:', err);
          }

          // 2. Dispatch event to silence UI & Audio immediately
          this.notifyChange('kitchen_alarm', {
            action: 'stop_alarm',
            source: 'supabase_broadcast',
            timestamp: payload.timestamp || Date.now(),
            orderIds: payload.orderIds || []
          });
        })
        .on('broadcast', { event: 'settings_updated' }, (event) => {
          const payload = event?.payload || {};
          console.log('[Supabase Realtime] Received cross-device settings_updated broadcast:', payload);
          if (payload.settings) {
            try {
              const current = this.getSettings();
              const merged = { ...current, ...payload.settings };
              localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
              this.notifyChange('settings', { settings: merged, source: 'supabase_broadcast' });
            } catch (err) {
              console.warn('[DataService] Error applying remote settings broadcast:', err);
            }
          }
        })
        .on('broadcast', { event: 'rider_location' }, (event) => {
          const payload = event?.payload || {};
          if (payload.lat && payload.lng) {
            try {
              localStorage.setItem('quickbite_live_rider_location', JSON.stringify(payload));
              window.dispatchEvent(new CustomEvent('quickbite:rider_location', { detail: payload }));
            } catch {}
            this.notifyChange('rider_location', payload);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[DataService] Kitchen cross-device broadcast channel connected.');
          }
        });
    } catch (err) {
      this.isSubscribingRealtime = false;
      console.warn('[QuickBite] Realtime subscription skipped:', err);
    }
  }

  /**
   * Sync active orders relevant to this customer in real time.
   */
  async syncCustomerActiveOrders() {
    try {
      let userId = null;
      let email = null;
      let phone = null;

      // 1. Read from quickbite_active_user_context
      try {
        const ctxStr = localStorage.getItem('quickbite_active_user_context');
        if (ctxStr) {
          const ctx = JSON.parse(ctxStr);
          if (ctx) {
            userId = ctx.id || userId;
            email = ctx.email || email;
            phone = ctx.phone || phone;
          }
        }
      } catch {}

      // 2. Read from quickbite_custom_user or quickbite_current_user
      try {
        const userStr = localStorage.getItem('quickbite_custom_user') || localStorage.getItem('quickbite_current_user');
        if (userStr) {
          const u = JSON.parse(userStr);
          if (u) {
            userId = u.id || userId;
            email = u.email || email;
            phone = phone || u.phone || u.user_metadata?.phone || null;
          }
        }
      } catch {}

      // 3. Fallback to saved addresses
      if (!phone) {
        try {
          const addrs = this.getAllAddressesRaw();
          const def = addrs.find(a => a.isDefault) || addrs[0];
          if (def && def.phone) phone = def.phone;
        } catch {}
      }

      await this.syncCustomerOrdersFromSupabase(userId, email, phone);
    } catch (e) {
      console.warn('[DataService] syncCustomerActiveOrders error:', e);
    }
  }

  /**
   * Resilient live heartbeat: fallback synchronization when WebSocket drops.
   * Realtime WebSocket handles instantaneous live updates (<200ms latency).
   * Polling acts only as a gentle 60s fallback or reconnect buffer.
   */
  startLiveHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // 60s fallback interval (Supabase Realtime WebSocket handles instantaneous updates)
    const intervalMs = 60000;

    this.heartbeatTimer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;

      try {
        if (this.portalType === 'admin' || this.portalType === 'delivery') {
          await this.syncOrdersFromSupabase();
        } else {
          // Customer portal: only poll if customer currently has active orders
          const orders = this.getOrders();
          const hasActiveOrders = orders.some(o => o && o.status !== 'delivered' && o.status !== 'cancelled');
          if (hasActiveOrders) {
            await this.syncCustomerActiveOrders();
          }
        }
      } catch (err) {}
    }, intervalMs);
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }

    // Throttled sync on tab focus or visibility restore (only if tab was away for at least 30s)
    if (typeof document !== 'undefined') {
      const handleTabResume = () => {
        if (document.hidden) return;
        const now = Date.now();
        if (this.portalType === 'admin' || this.portalType === 'delivery') {
          if (now - this._lastOrdersSyncTime > 30000) {
            this.syncOrdersFromSupabase();
          }
        } else {
          const orders = this.getOrders();
          const hasActiveOrders = orders.some(o => o && o.status !== 'delivered' && o.status !== 'cancelled');
          if (hasActiveOrders && now - this._lastCustomerOrdersSyncTime > 30000) {
            this.syncCustomerActiveOrders();
          }
        }
      };

      document.addEventListener('visibilitychange', handleTabResume);
      window.addEventListener('focus', handleTabResume);
    }
  }

  /**
   * Securely sync only orders belonging to the authenticated customer.
   * Prevents leaking other customer names, phones, and addresses.
   */
  async syncCustomerOrdersFromSupabase(userId = null, email = null, phone = null, force = false) {
    let sessionIds = [];
    try {
      const stored = localStorage.getItem('quickbite_my_order_ids');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) sessionIds = parsed;
      }
    } catch {}

    if (!userId && !email && !phone && sessionIds.length === 0) return;

    if (!force && Date.now() - this._lastCustomerOrdersSyncTime < 6000) return;
    if (this._isSyncingCustomerOrders) return this._isSyncingCustomerOrders;

    this._isSyncingCustomerOrders = (async () => {
      try {
        let query = supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false });

        // Server-side filter to only fetch customer's own orders (eliminates stranger data egress)
        const filterParts = [];
        if (userId) filterParts.push(`user_id.eq.${userId}`);
        if (email && typeof email === 'string' && email.includes('@')) filterParts.push(`customer_email.eq.${email}`);
        if (phone) filterParts.push(`customer_phone.eq.${phone}`);
        if (sessionIds && sessionIds.length > 0) {
          const cleanIds = sessionIds.filter(id => id && !String(id).includes(',') && !String(id).includes(' ')).slice(0, 30);
          if (cleanIds.length > 0) {
            filterParts.push(`id.in.(${cleanIds.join(',')})`);
          }
        }

        if (filterParts.length > 0) {
          query = query.or(filterParts.join(','));
        }

        const { data, error } = await query.limit(30);

        if (!error && Array.isArray(data)) {
          this._lastCustomerOrdersSyncTime = Date.now();
        const localList = this.getOrders();
        const rawAddrs = this.getAllAddressesRaw();
        let changed = false;

        const remoteMap = new Map();
        data.forEach(remote => {
          if (remote && remote.id) {
            remoteMap.set(String(remote.id), remote);
          }
        });

        const now = Date.now();

        // 1. Update matching local orders with remote status/metadata, and reconcile ghost local active orders
        localList.forEach(lo => {
          if (!lo || !this.isOrderForCustomer(lo, userId, email, phone)) return;

          const remote = remoteMap.get(String(lo.id));
          if (remote) {
            const recoveredPhone = extractPhoneFromOrder(remote, rawAddrs) || lo.customerPhone || remote.customer_phone || '';
            const mappedRemote = {
              customerName: remote.customer_name || lo.customerName,
              customerEmail: remote.customer_email || lo.customerEmail,
              customerPhone: recoveredPhone || lo.customerPhone,
              phone: recoveredPhone || lo.phone,
              customer_phone: recoveredPhone || lo.customer_phone,
              deliveryAddress: remote.delivery_address || lo.deliveryAddress,
              stepIndex: typeof remote.step_index === 'number' ? remote.step_index : lo.stepIndex,
              status: (remote.status !== 'cancelled' && (ORDER_STATUS_RANKS[lo.status] || 0) > (ORDER_STATUS_RANKS[remote.status] || 0)) ? lo.status : (remote.status || lo.status),
              statusLabel: remote.status_label || lo.statusLabel,
              eta: remote.eta || lo.eta,
              itemsSummary: remote.items_summary || lo.itemsSummary,
              pickupCode: remote.pickup_code || lo.pickupCode,
              assignedRiderPin: remote.assigned_rider_pin || lo.assignedRiderPin,
              assignedRiderName: remote.assigned_rider_name || lo.assignedRiderName,
              assignedRiderPhone: remote.assigned_rider_phone || lo.assignedRiderPhone,
              assignedRiderVehicle: remote.assigned_rider_vehicle || lo.assignedRiderVehicle,
              claimedAt: remote.claimed_at || lo.claimedAt,
              deliveredAt: remote.delivered_at || lo.deliveredAt,
              paymentMethod: remote.payment_method || lo.paymentMethod,
              paymentStatus: remote.payment_status || lo.paymentStatus,
              cancellationReason: remote.cancellation_reason || lo.cancellationReason || null
            };

            // Remote database status is authoritative
            const isDifferent = lo.status !== mappedRemote.status || 
                                lo.eta !== mappedRemote.eta || 
                                lo.statusLabel !== mappedRemote.statusLabel ||
                                lo.stepIndex !== mappedRemote.stepIndex ||
                                lo.assignedRiderPin !== mappedRemote.assignedRiderPin;
            if (isDifferent) {
              const prevStatus = lo.status;
              Object.assign(lo, mappedRemote);
              changed = true;
              this.notifyChange('orders', { action: 'status_updated', orderId: lo.id, order: lo, prevStatus, source: 'supabase' });
            } else {
              Object.assign(lo, mappedRemote);
            }
          }
        });

        // 2. Add remote orders belonging to this customer that are not yet in localList
        data.forEach(remote => {
          if (!remote || !remote.id) return;
          const exists = localList.some(l => l && String(l.id) === String(remote.id));
          if (!exists) {
            const recoveredPhone = extractPhoneFromOrder(remote, rawAddrs) || remote.customer_phone || '';
            const mapped = {
              id: remote.id,
              createdAt: Number(remote.created_at) || Date.now(),
              userId: remote.user_id || null,
              customerName: remote.customer_name || 'Customer',
              customerEmail: remote.customer_email || '',
              customerPhone: recoveredPhone,
              phone: recoveredPhone,
              customer_phone: recoveredPhone,
              deliveryAddress: remote.delivery_address || 'Express Delivery',
              stepIndex: typeof remote.step_index === 'number' ? remote.step_index : 0,
              status: remote.status || 'accepted',
              statusLabel: remote.status_label || 'Accepted',
              eta: remote.eta || '25 - 35 Minutes',
              itemsSummary: remote.items_summary || '',
              items: remote.items || [],
              total: remote.total || '$0.00',
              paymentMethod: remote.payment_method || 'Cash on Delivery (COD)',
              paymentStatus: remote.payment_status || 'Cash on Delivery',
              pickupCode: remote.pickup_code || null,
              assignedRiderPin: remote.assigned_rider_pin || null,
              assignedRiderName: remote.assigned_rider_name || null,
              assignedRiderPhone: remote.assigned_rider_phone || null,
              assignedRiderVehicle: remote.assigned_rider_vehicle || null,
              claimedAt: remote.claimed_at || null,
              deliveredAt: remote.delivered_at || null,
              lat: remote.lat ? Number(remote.lat) : null,
              lng: remote.lng ? Number(remote.lng) : null,
              addressDetails: remote.address_details || null,
              cancellationReason: remote.cancellation_reason || null
            };

            if (this.isOrderForCustomer(mapped, userId, email, phone)) {
              localList.unshift(mapped);
              changed = true;
              this.notifyChange('orders', { action: 'new_order', order: mapped, source: 'supabase' });
            }
          }
        });

        if (changed) {
          localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(localList));
          this.notifyChange('orders');
        }
      }
    } catch (e) {
      console.warn('[DataService] syncCustomerOrdersFromSupabase error:', e);
    }
  })().finally(() => {
    this._isSyncingCustomerOrders = null;
  });

  return this._isSyncingCustomerOrders;
}

  notifyChange(type, extra = {}) {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('quickbite_data_changed', { detail: { type, ...extra } }));
    }
    
    // Broadcast via persistent BroadcastChannel instance without closing it
    try {
      if (this.syncBroadcastChannel) {
        this.syncBroadcastChannel.postMessage({ type, timestamp: Date.now(), ...extra });
      }
    } catch {}

    // Explicitly write storage sync triggers so other tabs in the same origin fire storage events immediately
    try {
      if (type === 'orders') {
        if (extra.action === 'status_updated') {
          localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
            ...extra,
            timestamp: Date.now()
          }));
        } else if (extra.action === 'new_order') {
          localStorage.setItem('quickbite_latest_incoming_order', JSON.stringify({
            ...(extra.order || {}),
            timestamp: Date.now()
          }));
        }
        localStorage.setItem('quickbite_orders_sync_ping', String(Date.now()));
      } else if (type === 'kitchen_alarm') {
        localStorage.setItem('quickbite_alarm_stopped_sync', JSON.stringify({
          ...extra,
          timestamp: Date.now()
        }));
      } else if (type === 'settings') {
        localStorage.setItem('quickbite_settings_sync', JSON.stringify({
          ...extra,
          timestamp: Date.now()
        }));
      } else if (type === 'addresses') {
        localStorage.setItem('quickbite_addresses_sync', JSON.stringify({
          ...extra,
          timestamp: Date.now()
        }));
      } else if (type === 'categories') {
        localStorage.setItem('quickbite_categories_sync', String(Date.now()));
      }
    } catch {}
  }

  broadcastStopAlarm(payload = {}) {
    const orders = this.getOrders();
    let targetIds = Array.isArray(payload.orderIds) && payload.orderIds.length > 0 ? [...payload.orderIds] : [];

    // If no specific orderIds provided, acknowledge all currently unacknowledged pending/accepted orders
    if (targetIds.length === 0) {
      targetIds = orders.filter(o => (o.status === 'accepted' || o.status === 'pending') && !o.alarmAcknowledged).map(o => o.id);
    }

    const data = {
      timestamp: payload.timestamp || Date.now(),
      orderIds: targetIds,
      ...payload
    };

    // 1. Send via Supabase WebSocket broadcast (instant cross-device, works between separate phones/laptops/tablets)
    try {
      if (!this.sharedBroadcastChannel && supabase) {
        this.sharedBroadcastChannel = supabase.channel('quickbite-kitchen-broadcast', {
          config: { broadcast: { self: false } }
        });
        this.sharedBroadcastChannel.subscribe();
      }
      if (this.sharedBroadcastChannel) {
        this.sharedBroadcastChannel.send({
          type: 'broadcast',
          event: 'stop_alarm',
          payload: data
        }).catch(err => console.warn('[Supabase Realtime] send broadcast error:', err));
      }
    } catch (err) {
      console.warn('[Supabase Realtime] broadcast error:', err);
    }

    // 2. Mark orders as alarmAcknowledged so DB sync won't trigger alarm on other devices
    if (data.orderIds && data.orderIds.length > 0) {
      let changed = false;
      data.orderIds.forEach(id => {
        const o = orders.find(ord => ord.id === id);
        if (o && !o.alarmAcknowledged) {
          o.alarmAcknowledged = true;
          o.alarmStoppedAt = data.timestamp;
          changed = true;
        }
      });
      if (changed) {
        this.saveOrders(orders, { action: 'alarm_acknowledged', orderIds: data.orderIds });
      }
    }

    // 3. Fire local event and BroadcastChannel & localStorage
    this.notifyChange('kitchen_alarm', {
      action: 'stop_alarm',
      source: 'local',
      ...data
    });
  }

  broadcastSettings(settings) {
    try {
      if (!this.sharedBroadcastChannel && supabase) {
        this.sharedBroadcastChannel = supabase.channel('quickbite-kitchen-broadcast', {
          config: { broadcast: { self: false } }
        });
        this.sharedBroadcastChannel.subscribe();
      }
      if (this.sharedBroadcastChannel) {
        this.sharedBroadcastChannel.send({
          type: 'broadcast',
          event: 'settings_updated',
          payload: {
            settings,
            timestamp: Date.now()
          }
        }).catch(err => console.warn('[Supabase Realtime] settings broadcast error:', err));
      }
    } catch (err) {
      console.warn('[Supabase Realtime] settings broadcast exception:', err);
    }
  }

  broadcastRiderLocation(payload) {
    if (!payload || !payload.lat || !payload.lng) return;
    const cleanPayload = {
      orderId: payload.orderId || null,
      orderIds: Array.isArray(payload.orderIds) ? payload.orderIds : (payload.orderId ? [payload.orderId] : []),
      riderPin: payload.riderPin || null,
      riderName: payload.riderName || 'Delivery Partner',
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      heading: payload.heading != null ? Number(payload.heading) : null,
      speed: payload.speed != null ? Number(payload.speed) : null,
      accuracy: Math.round(payload.accuracy || 10),
      timestamp: payload.timestamp || Date.now()
    };

    try {
      localStorage.setItem('quickbite_live_rider_location', JSON.stringify(cleanPayload));
      if (cleanPayload.orderId) {
        localStorage.setItem(`quickbite_rider_location_${cleanPayload.orderId}`, JSON.stringify(cleanPayload));
      }
      if (cleanPayload.riderPin) {
        localStorage.setItem(`quickbite_rider_location_pin_${cleanPayload.riderPin}`, JSON.stringify(cleanPayload));
      }
      window.dispatchEvent(new CustomEvent('quickbite:rider_location', { detail: cleanPayload }));
    } catch {}

    try {
      if (this.sharedBroadcastChannel) {
        this.sharedBroadcastChannel.send({
          type: 'broadcast',
          event: 'rider_location',
          payload: cleanPayload
        }).catch(err => console.warn('[DataService] Rider location broadcast failed:', err));
      }
    } catch (err) {
      console.warn('[DataService] Error sending rider location broadcast:', err);
    }

    this.notifyChange('rider_location', cleanPayload);
  }

  getRiderLiveLocation(orderId = null, riderPin = null) {
    try {
      if (orderId) {
        const orderStored = localStorage.getItem(`quickbite_rider_location_${orderId}`);
        if (orderStored) {
          const parsed = JSON.parse(orderStored);
          if (parsed && parsed.lat && parsed.lng && Date.now() - (parsed.timestamp || 0) < 900000) {
            return parsed;
          }
        }
      }
      if (riderPin) {
        const pinStored = localStorage.getItem(`quickbite_rider_location_pin_${riderPin}`);
        if (pinStored) {
          const parsed = JSON.parse(pinStored);
          if (parsed && parsed.lat && parsed.lng && Date.now() - (parsed.timestamp || 0) < 900000) {
            return parsed;
          }
        }
      }
      const stored = localStorage.getItem('quickbite_live_rider_location');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.lat && parsed.lng) {
          if (Date.now() - (parsed.timestamp || 0) < 900000) {
            return parsed;
          }
        }
      }
    } catch {}
    return null;
  }

  async syncSettingsFromSupabase(force = false) {
    if (!force && Date.now() - this._lastSettingsSyncTime < 120000) {
      return this.getSettings();
    }
    if (this._isSyncingSettings) return this._isSyncingSettings;

    this._isSyncingSettings = (async () => {
      try {
        if (!supabase) return null;
        const { data, error } = await supabase
          .from('store_settings')
          .select('*')
          .in('id', ['restaurant_config', 'main_settings']);

        if (!error && Array.isArray(data) && data.length > 0) {
          // Explicitly prioritize restaurant_config over legacy main_settings
          const configRow = data.find(r => r.id === 'restaurant_config') || data.find(r => r.id === 'main_settings') || data[0];
          if (configRow && configRow.settings) {
            const raw = configRow.settings;
            const phone = raw.restaurantPhone || raw.helpline || DEFAULT_SETTINGS.restaurantPhone;
            const merged = {
              ...DEFAULT_SETTINGS,
              ...raw,
              restaurantPhone: phone,
              helpline: phone
            };
            if (merged.offerTitle && (merged.offerTitle.includes('SMM') || merged.offerTitle.includes('Cryspy'))) {
              merged.offerTitle = merged.offerTitle.replace(/SMM Taj|SMM/gi, 'Savera');
            }
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
            this.notifyChange('settings', { settings: merged, source: 'supabase' });
            this._lastSettingsSyncTime = Date.now();
            return merged;
          }
        }
      } catch (err) {
        // Silently fall back to localStorage
      }
      return null;
    })().finally(() => {
      this._isSyncingSettings = null;
    });

    return this._isSyncingSettings;
  }

  async syncSettingsToSupabase(settings) {
    try {
      if (!supabase) return;
      const phone = settings.restaurantPhone || settings.helpline || DEFAULT_SETTINGS.restaurantPhone;
      const payloadSettings = {
        ...settings,
        restaurantPhone: phone,
        helpline: phone
      };
      // Upsert both 'restaurant_config' and 'main_settings' to keep all views and database rows synchronized
      await supabase
        .from('store_settings')
        .upsert([
          {
            id: 'restaurant_config',
            settings: payloadSettings,
            updated_at: new Date().toISOString()
          },
          {
            id: 'main_settings',
            settings: payloadSettings,
            updated_at: new Date().toISOString()
          }
        ], { onConflict: 'id' });
    } catch (err) {
      console.warn('[DataService] syncSettingsToSupabase error:', err);
    }
  }

  subscribeToChanges(callback) {
    const handler = (e) => {
      if (typeof callback === 'function') {
        callback(e.detail?.type, e.detail);
      }
    };
    window.addEventListener('quickbite_data_changed', handler);
    return () => window.removeEventListener('quickbite_data_changed', handler);
  }

  on(eventName, callback) {
    if (typeof callback !== 'function') return () => {};
    return this.subscribeToChanges((type, detail) => {
      if (!eventName || eventName === '*' || eventName === type || eventName === `change:${type}`) {
        try {
          callback(detail);
        } catch (err) {
          console.warn('[DataService] on listener callback error:', err);
        }
      }
    });
  }

  // --- CATEGORIES & CATEGORY IMAGES STORE ---
  getCategoryImages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CATEGORY_IMAGES);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  getAllCategoryImage() {
    try {
      const map = this.getCategoryImages();
      const custom = (map['all'] || map['cat-all'] || '').trim();
      if (custom) return sanitizeCategoryImageUrl(custom);
    } catch {}
    return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200&auto=format&fit=crop&q=80';
  }

  setAllCategoryImage(imageUrl) {
    const sanitized = imageUrl && typeof imageUrl === 'string' && imageUrl.trim()
      ? sanitizeCategoryImageUrl(imageUrl.trim())
      : '';
    this.saveCategoryImage('all', sanitized);
    this.saveCategoryImage('cat-all', sanitized);
    this.notifyChange('categories');
    return sanitized;
  }

  saveCategoryImage(idOrSlug, imageUrl) {
    if (!idOrSlug) return;
    try {
      const map = this.getCategoryImages();
      const sanitized = imageUrl && typeof imageUrl === 'string' && imageUrl.trim()
        ? sanitizeCategoryImageUrl(imageUrl.trim())
        : '';

      if (sanitized) {
        map[idOrSlug] = sanitized;
      } else {
        delete map[idOrSlug];
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.CATEGORY_IMAGES, JSON.stringify(map));
      }

      // Asynchronously push to Supabase store_settings row 'category_images'
      if (supabase) {
        supabase.from('store_settings').upsert([{
          id: 'category_images',
          settings: map,
          updated_at: new Date().toISOString()
        }]).then(({ error }) => {
          if (error) console.warn('[Supabase] Persist category_images error:', error.message);
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[DataService] saveCategoryImage error:', e);
    }
  }

  removeCategoryImage(idOrSlug) {
    if (!idOrSlug) return;
    try {
      const map = this.getCategoryImages();
      delete map[idOrSlug];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.CATEGORY_IMAGES, JSON.stringify(map));
      }

      if (supabase) {
        supabase.from('store_settings').upsert([{
          id: 'category_images',
          settings: map,
          updated_at: new Date().toISOString()
        }]).then(({ error }) => {
          if (error) console.warn('[Supabase] Remove category_images error:', error.message);
        }).catch(() => {});
      }
    } catch {}
  }

  getCategories() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      let list = data ? JSON.parse(data) : DEFAULT_CATEGORIES;
      if (!Array.isArray(list) || list.length === 0 || list.some(c => c.id === 'cat-mandi' || c.id === 'cat-mutton' || c.id === 'cat-soups')) {
        list = DEFAULT_CATEGORIES;
        localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(DEFAULT_CATEGORIES));
      }
      const customImages = this.getCategoryImages();
      // Enrich categories with user custom photos first, then default photos
      return list.map(cat => {
        const customImg = (customImages[cat.id] || (cat.slug ? customImages[cat.slug] : '') || cat.image || '').trim();
        if (customImg) {
          return { ...cat, image: sanitizeCategoryImageUrl(customImg) };
        }
        const match = DEFAULT_CATEGORIES.find(d => d.id === cat.id || d.slug === cat.slug);
        if (match && match.image) {
          return { ...cat, image: sanitizeCategoryImageUrl(match.image) };
        }
        return { ...cat, image: sanitizeCategoryImageUrl(cat.image || '') };
      });
    } catch {
      return DEFAULT_CATEGORIES;
    }
  }

  saveCategories(categories) {
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
    if (Array.isArray(categories)) {
      const customImages = this.getCategoryImages();
      let hasNew = false;
      categories.forEach(cat => {
        if (cat && cat.image && typeof cat.image === 'string' && cat.image.trim()) {
          const trimmed = sanitizeCategoryImageUrl(cat.image.trim());
          if (cat.id && customImages[cat.id] !== trimmed) {
            customImages[cat.id] = trimmed;
            hasNew = true;
          }
          if (cat.slug && customImages[cat.slug] !== trimmed) {
            customImages[cat.slug] = trimmed;
            hasNew = true;
          }
        }
      });
      if (hasNew) {
        try {
          localStorage.setItem(STORAGE_KEYS.CATEGORY_IMAGES, JSON.stringify(customImages));
          if (supabase) {
            supabase.from('store_settings').upsert([{
              id: 'category_images',
              settings: customImages,
              updated_at: new Date().toISOString()
            }]).then(({ error }) => {
              if (error) console.warn('[Supabase] Persist category_images error:', error.message);
            }).catch(() => {});
          }
        } catch {}
      }
    }
    this.notifyChange('categories');
  }

  addCategory(category) {
    const list = this.getCategories();
    const slug = category.slug || category.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const imageVal = sanitizeCategoryImageUrl((category.image || '').trim());
    const newCat = {
      id: 'cat-' + Date.now(),
      name: category.name.trim(),
      emoji: category.emoji || '🍽️',
      image: imageVal,
      slug: slug
    };
    if (newCat.image) {
      this.saveCategoryImage(newCat.id, newCat.image);
      this.saveCategoryImage(newCat.slug, newCat.image);
    }
    list.push(newCat);
    this.saveCategories(list);

    // Asynchronously push to Supabase safely
    const payload = {
      id: newCat.id,
      name: newCat.name,
      emoji: newCat.emoji,
      slug: newCat.slug
    };
    if (newCat.image) payload.image = newCat.image;

    supabase.from('categories').insert([payload]).then(({ error }) => {
      if (error) {
        if (error.message && error.message.includes("'image'")) {
          // Schema does not have image column: retry insert cleanly without image column
          delete payload.image;
          supabase.from('categories').insert([payload]).then(({ error: retryErr }) => {
            if (retryErr) console.warn('[Supabase] addCategory fallback error:', retryErr.message);
          });
        } else {
          console.warn('[Supabase] addCategory error:', error.message);
        }
      }
    });

    return newCat;
  }

  updateCategory(id, updatedData) {
    const list = this.getCategories();
    const idx = list.findIndex(c => c.id === id || c.slug === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updatedData };
      if (list[idx].image !== undefined) {
        const sanitized = sanitizeCategoryImageUrl(list[idx].image);
        list[idx].image = sanitized;
        this.saveCategoryImage(list[idx].id, sanitized);
        if (list[idx].slug) this.saveCategoryImage(list[idx].slug, sanitized);
      }
      this.saveCategories(list);

      // Asynchronously update in Supabase safely
      const updatePayload = {
        name: list[idx].name,
        emoji: list[idx].emoji,
        slug: list[idx].slug
      };
      if (list[idx].image !== undefined) updatePayload.image = list[idx].image;

      supabase.from('categories').update(updatePayload).eq('id', list[idx].id).then(({ error }) => {
        if (error) {
          if (error.message && error.message.includes("'image'")) {
            // Supabase schema cache has no image column: retry without it so name/emoji/slug update
            delete updatePayload.image;
            supabase.from('categories').update(updatePayload).eq('id', list[idx].id).then(({ error: retryErr }) => {
              if (retryErr) console.warn('[Supabase] updateCategory fallback error:', retryErr.message);
            });
          } else {
            console.warn('[Supabase] updateCategory error:', error.message);
          }
        }
      });

      return list[idx];
    }
    return null;
  }

  deleteCategory(id) {
    const list = this.getCategories();
    const cat = list.find(c => c.id === id || c.slug === id);
    const filtered = list.filter(c => c.id !== id && c.slug !== id);
    this.saveCategories(filtered);
    if (cat) {
      this.removeCategoryImage(cat.id);
      if (cat.slug) this.removeCategoryImage(cat.slug);
    }

    // Asynchronously delete from Supabase
    supabase.from('categories').delete().eq('id', cat ? cat.id : id).then(({ error }) => {
      if (error) console.warn('[Supabase] deleteCategory error:', error.message);
    });

    return true;
  }

  getDishes() {
    if (this.dishesCache && Array.isArray(this.dishesCache) && this.dishesCache.length > 0) {
      return this.dishesCache;
    }
    let list = null;
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DISHES);
      if (data) {
        list = JSON.parse(data);
      }
    } catch {}
    if (!Array.isArray(list) || list.length === 0) {
      list = [...DEFAULT_DISHES];
    }
    this.dishesCache = list.map(d => ({
      ...d,
      image: sanitizeDishImageUrl(d.image)
    }));
    return this.dishesCache;
  }

  getDishById(id) {
    if (!id) return null;
    const cleanId = String(id).replace(/^card-/, '').trim();
    const dishes = this.getDishes();
    return dishes.find(d => d.id === cleanId || d.id === id) || null;
  }

  saveDishes(dishes) {
    if (!Array.isArray(dishes)) return;
    this.dishesCache = dishes;

    // 1. Always persist complete high-resolution data to IndexedDB (No 5MB limit)
    idbSet('dishes', dishes).catch(err => {
      console.warn('[DataService] idbSet dishes error:', err);
    });

    // 2. Try to persist to localStorage safely
    try {
      localStorage.setItem(STORAGE_KEYS.DISHES, JSON.stringify(dishes));
    } catch (quotaErr) {
      console.warn('[DataService] LocalStorage quota reached for full dishes payload. Keeping full data in IndexedDB and saving optimized copy to localStorage:', quotaErr?.message || quotaErr);
      try {
        // Strip excessive base64 strings only for localStorage copy so localStorage doesn't throw QuotaExceededError
        const safeLocalDishes = dishes.map(d => {
          if (d.image && d.image.startsWith('data:') && d.image.length > 40000) {
            return { ...d, image: d.image.slice(0, 30000) };
          }
          return d;
        });
        localStorage.setItem(STORAGE_KEYS.DISHES, JSON.stringify(safeLocalDishes));
      } catch {
        // IndexedDB holds the authoritative data
      }
    }

    this.notifyChange('dishes');
  }

  // --- UPLOADED IMAGES GALLERY ---
  getUploadedImages() {
    if (this.uploadedImagesCache && Array.isArray(this.uploadedImagesCache)) {
      return this.uploadedImagesCache;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.UPLOADED_IMAGES);
      if (stored) {
        this.uploadedImagesCache = JSON.parse(stored);
        return this.uploadedImagesCache;
      }
    } catch {}
    this.uploadedImagesCache = [];
    return this.uploadedImagesCache;
  }

  async saveUploadedImage(url, name = 'Custom Upload') {
    if (!url) return null;
    const uploads = [...this.getUploadedImages()];
    const existingIdx = uploads.findIndex(u => u.url === url);
    if (existingIdx !== -1) {
      const [item] = uploads.splice(existingIdx, 1);
      item.uploadedAt = Date.now();
      uploads.unshift(item);
    } else {
      const newItem = {
        id: 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        url: url,
        name: name || 'Uploaded Photo',
        uploadedAt: Date.now()
      };
      uploads.unshift(newItem);
    }

    const trimmed = uploads.slice(0, 50);
    this.uploadedImagesCache = trimmed;

    // 1. Persist to IndexedDB
    idbSet('uploaded_images', trimmed).catch(() => {});

    // 2. Persist to localStorage safely
    try {
      localStorage.setItem(STORAGE_KEYS.UPLOADED_IMAGES, JSON.stringify(trimmed));
    } catch (quotaErr) {
      try {
        localStorage.setItem(STORAGE_KEYS.UPLOADED_IMAGES, JSON.stringify(trimmed.slice(0, 5)));
      } catch {}
    }

    this.notifyChange('uploaded_images');
    return uploads[0];
  }

  async deleteUploadedImage(idOrUrl) {
    const uploads = this.getUploadedImages().filter(u => u.id !== idOrUrl && u.url !== idOrUrl);
    this.uploadedImagesCache = uploads;
    idbSet('uploaded_images', uploads).catch(() => {});
    try {
      localStorage.setItem(STORAGE_KEYS.UPLOADED_IMAGES, JSON.stringify(uploads));
    } catch {}
    this.notifyChange('uploaded_images');
    return true;
  }

  addDish(dishData) {
    const list = this.getDishes();
    const newDish = {
      id: 'item-' + Date.now(),
      name: dishData.name.trim(),
      category: dishData.category,
      categoryName: dishData.categoryName || '',
      price: parseFloat(dishData.price) || 9.99,
      rating: '',
      image: dishData.image || '/api/r2-image?key=dishes/crispy-chicken.jpg',
      badge: dishData.badge || '✨ Chef Specialty',
      time: dishData.time || '10 - 15 mins',
      calories: dishData.calories || '520 kcal',
      diet: dishData.diet || 'Fresh Daily',
      desc: dishData.desc || `${dishData.name} prepared fresh in our kitchen with premium ingredients.`,
      inStock: dishData.inStock !== false
    };
    list.unshift(newDish);
    this.saveDishes(list);

    // Asynchronously insert into Supabase (Guard: NEVER save raw Base64 data to Supabase)
    const remoteDishImage = (newDish.image && !newDish.image.startsWith('data:'))
      ? newDish.image
      : '/api/r2-image?key=dishes/crispy-chicken.jpg';

    supabase.from('dishes').insert([{
      id: newDish.id,
      name: newDish.name,
      category: newDish.category,
      category_name: newDish.categoryName,
      price: newDish.price,
      rating: newDish.rating,
      image: remoteDishImage,
      badge: newDish.badge,
      time: newDish.time,
      calories: newDish.calories,
      diet: newDish.diet,
      description: newDish.desc,
      in_stock: newDish.inStock
    }]).then(({ error }) => {
      if (error) console.warn('[Supabase] addDish error:', error.message);
    });

    return newDish;
  }

  updateDish(id, updatedData) {
    const list = this.getDishes();
    const idx = list.findIndex(d => d.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updatedData };
      this.saveDishes(list);

      const d = list[idx];
      const updatePayload = {
        name: d.name,
        category: d.category,
        category_name: d.categoryName,
        price: d.price,
        badge: d.badge,
        time: d.time,
        calories: d.calories,
        diet: d.diet,
        description: d.desc,
        in_stock: d.inStock
      };
      // Guard: Only update image in Supabase if it's a valid remote/R2 URL and NOT raw Base64 data
      if (d.image && !d.image.startsWith('data:')) {
        updatePayload.image = d.image;
      }

      supabase.from('dishes').update(updatePayload).eq('id', id).then(({ error }) => {
        if (error) console.warn('[Supabase] updateDish error:', error.message);
      });

      return list[idx];
    }
    return null;
  }

  toggleDishStock(id) {
    const list = this.getDishes();
    const dish = list.find(d => d.id === id);
    if (dish) {
      dish.inStock = !dish.inStock;
      this.saveDishes(list);

      supabase.from('dishes').update({ in_stock: dish.inStock }).eq('id', id).then(({ error }) => {
        if (error) console.warn('[Supabase] toggleDishStock error:', error.message);
      });

      return dish;
    }
    return null;
  }

  deleteDish(id) {
    const list = this.getDishes();
    const filtered = list.filter(d => d.id !== id);
    this.saveDishes(filtered);

    supabase.from('dishes').delete().eq('id', id).then(({ error }) => {
      if (error) console.warn('[Supabase] deleteDish error:', error.message);
    });

    return true;
  }

  // --- ORDERS ---
  getOrders() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ORDERS);
      if (!data) return [];
      const list = JSON.parse(data);
      if (!Array.isArray(list)) return [];
      // Clean out any legacy mock test orders (#QB-8942, #QB-7419)
      const realOrders = list.filter(o => o && o.id !== '#QB-8942' && o.id !== '#QB-7419');

      // Auto-heal missing coordinates & customer phone on orders by matching with saved user addresses
      const rawAddrs = this.getAllAddressesRaw();
      let hasHealed = false;

      realOrders.forEach(o => {
        // Auto-expire stale local orders older than 3 hours on customer portal so ghost orders never lock out checkout
        if (this.portalType === 'customer' && o.status !== 'delivered' && o.status !== 'cancelled' && o.createdAt) {
          const orderAgeMs = Date.now() - Number(o.createdAt);
          if (orderAgeMs > 3 * 60 * 60 * 1000) {
            o.status = 'delivered';
            o.statusLabel = 'Delivered';
            o.stepIndex = 4;
            o.eta = 'Delivered 🎉';
            hasHealed = true;
          }
        }

        // Auto-heal missing or invalid phone number on order
        if (!o.customerPhone || String(o.customerPhone).replace(/\D/g, '').length < 10) {
          const recoveredPhone = extractPhoneFromOrder(o, rawAddrs);
          if (recoveredPhone) {
            o.customerPhone = recoveredPhone;
            o.customer_phone = recoveredPhone;
            o.phone = recoveredPhone;
            hasHealed = true;
          }
        }

        const hasValidCoords = (o.addressDetails && !isNaN(Number(o.addressDetails.lat)) && Number(o.addressDetails.lat) !== 0) ||
                               (!isNaN(Number(o.lat)) && Number(o.lat) !== 0);

        if (!hasValidCoords && Array.isArray(rawAddrs) && rawAddrs.length > 0) {
          const matched = rawAddrs.find(a => 
            (o.userId && a.userId && o.userId === a.userId) ||
            (o.customerEmail && a.userEmail && o.customerEmail.toLowerCase() === a.userEmail.toLowerCase()) ||
            (o.customerPhone && a.phone && a.phone.replace(/\D/g, '').slice(-10) === (o.customerPhone || '').replace(/\D/g, '').slice(-10)) ||
            (o.deliveryAddress && a.flatNo && o.deliveryAddress.includes(a.flatNo))
          );

          if (matched && matched.lat && matched.lng && !isNaN(Number(matched.lat))) {
            o.lat = Number(matched.lat);
            o.lng = Number(matched.lng);
            if (!o.customerPhone && matched.phone) {
              o.customerPhone = matched.phone;
              o.phone = matched.phone;
              o.customer_phone = matched.phone;
            }
            if (!o.addressDetails) {
              o.addressDetails = {
                tag: matched.tag,
                flatNo: matched.flatNo,
                area: matched.area,
                city: matched.city,
                pincode: matched.pincode,
                phone: matched.phone || o.customerPhone || '',
                lat: Number(matched.lat),
                lng: Number(matched.lng),
                distanceKm: matched.distanceKm
              };
            } else {
              o.addressDetails.lat = Number(matched.lat);
              o.addressDetails.lng = Number(matched.lng);
              if (!o.addressDetails.phone && matched.phone) {
                o.addressDetails.phone = matched.phone;
              }
            }
            hasHealed = true;
          }
        }

        // Auto-heal 4-digit Bag Pickup Code from Order ID (e.g. 1797 from #QB-1797)
        if (!o.pickupCode && o.id) {
          const digits = String(o.id).replace(/\D/g, '');
          o.pickupCode = digits.length >= 4 ? digits.slice(-4) : (digits || '1001');
          hasHealed = true;
        }
      });

      if (hasHealed || realOrders.length !== list.length) {
        localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(realOrders));
      }
      return realOrders;
    } catch {
      return [];
    }
  }

  getOrderById(orderId) {
    if (!orderId) return null;
    const list = this.getOrders();
    const norm = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanTarget = norm(orderId);
    return list.find(o => o && norm(o.id) === cleanTarget) || null;
  }

  isOrderForCustomer(o, userId = null, email = null, phone = null) {
    if (!o) return false;
    let myIds = [];
    try {
      const stored = localStorage.getItem('quickbite_my_order_ids');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) myIds = parsed;
      }
    } catch {}

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
    const orderEmail = (o.customerEmail || '').trim().toLowerCase();
    const orderPhone = (o.customerPhone || o.phone || o.customer_phone || '').replace(/\D/g, '').slice(-10);

    // Strict account isolation: never attach an order belonging to a different userId or email
    if (userId && o.userId && String(o.userId) !== String(userId)) {
      return false;
    }
    if (cleanEmail && orderEmail && orderEmail !== cleanEmail) {
      return false;
    }

    if (userId && o.userId && String(o.userId) === String(userId)) return true;
    if (cleanEmail && orderEmail && orderEmail === cleanEmail) return true;
    if (cleanPhone && cleanPhone.length === 10 && orderPhone === cleanPhone) return true;
    if (myIds.includes(o.id)) return true;
    return false;
  }

  getCustomerOrders(userId = null, userEmail = null, userPhone = null) {
    const all = this.getOrders();
    return all.filter(o => this.isOrderForCustomer(o, userId, userEmail, userPhone));
  }

  getCustomerActiveOrders(userId = null, userEmail = null, userPhone = null) {
    const customerOrders = this.getCustomerOrders(userId, userEmail, userPhone);
    const activeOrders = customerOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
    activeOrders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return activeOrders;
  }

  getCustomerPastOrders(userId = null, userEmail = null, userPhone = null) {
    const customerOrders = this.getCustomerOrders(userId, userEmail, userPhone);
    return customerOrders.filter(o => o.status === 'delivered' || o.status === 'cancelled');
  }

  saveOrders(orders, extra = {}) {
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    this.notifyChange('orders', extra);
  }

  async addOrder(orderData) {
    if (!orderData) return { success: false, error: new Error('Missing order data') };

    // 1. Master Store Open / Closed Check
    const settings = this.getSettings();
    if ((settings.storeOpen === false || !this.isStoreOpen()) && !orderData.bypassClosedCheck && !orderData.isDemo) {
      const msg = settings.storeClosedReason || 'The kitchen is currently closed for orders.';
      return {
        success: false,
        reason: 'store_closed',
        error: new Error(msg),
        message: msg
      };
    }

    // 2. Dish Stock Integrity Check: reject if any item is marked out of stock
    const dishes = this.getDishes();
    const rawItems = Array.isArray(orderData.items) ? orderData.items : [];
    for (const item of rawItems) {
      const dish = dishes.find(d => d.id === item.id || d.name === item.name);
      if (dish && dish.inStock === false) {
        const msg = `"${dish.name}" is currently sold out and cannot be ordered.`;
        return {
          success: false,
          reason: 'out_of_stock',
          item: dish.name,
          error: new Error(msg),
          message: msg
        };
      }
    }
    const rawAddrs = this.getAllAddressesRaw();
    // Guarantee customerPhone is populated
    if (!orderData.customerPhone || String(orderData.customerPhone).replace(/\D/g, '').length < 10) {
      orderData.customerPhone = extractPhoneFromOrder(orderData, rawAddrs) || orderData.customer_phone || orderData.phone || '';
    }
    orderData.phone = orderData.customerPhone;
    orderData.customer_phone = orderData.customerPhone;

    // Ensure phone is embedded in deliveryAddress for cloud persistence across any schema
    if (orderData.customerPhone && orderData.deliveryAddress && !orderData.deliveryAddress.includes('[Phone:')) {
      orderData.deliveryAddress = `${orderData.deliveryAddress} [Phone: ${orderData.customerPhone}]`;
    }

    // Generate 4-digit Bag Pickup Code from Order ID (e.g. 1797 from #QB-1797)
    if (!orderData.pickupCode) {
      const digits = String(orderData.id || '').replace(/\D/g, '');
      orderData.pickupCode = digits.length >= 4 ? digits.slice(-4) : (digits || Math.floor(1000 + Math.random() * 9000).toString());
    }
    // FINANCIAL INTEGRITY: Authoritative Subtotal & Delivery Fee Recalculation
    let computedSubtotal = 0;
    const sanitizedItems = (Array.isArray(orderData.items) ? orderData.items : []).map(item => {
      const dish = dishes.find(d => d.id === item.id || d.name === item.name);
      const cleanPrice = dish ? Number(dish.price) : Math.max(0, Number(item.price) || 0);
      const cleanQty = Math.max(1, Math.min(50, Math.floor(Number(item.quantity) || 1)));
      computedSubtotal += cleanPrice * cleanQty;
      return {
        name: String(item.name || dish?.name || 'Crispy Item').slice(0, 100),
        quantity: cleanQty,
        price: cleanPrice
      };
    });

    // Authoritative delivery fee calculation
    const threshold = Number(settings.freeDeliveryThreshold) || 250;
    const standardFee = Number(settings.deliveryFeeStandard) || 40;
    let deliveryFee = computedSubtotal >= threshold ? 0 : standardFee;

    // Validate coupon code boundaries against store settings
    let discount = 0;
    if (orderData.appliedPromo || orderData.promoCode) {
      const code = String(orderData.appliedPromo || orderData.promoCode).trim().toUpperCase();
      if (settings.offerActive && code === String(settings.offerCode || 'CRISPY20').trim().toUpperCase()) {
        if (computedSubtotal >= (Number(settings.offerMinOrder) || 0)) {
          if (settings.offerDiscountType === 'percent') {
            discount = Math.round((computedSubtotal * (Number(settings.offerDiscountPercent) || 20)) / 100);
          } else {
            discount = Number(settings.offerDiscountAmount) || 50;
          }
          if (settings.offerFreeDelivery) {
            deliveryFee = 0;
          }
        }
      }
    }

    discount = Math.min(discount, computedSubtotal);
    const calculatedTotal = Math.max(0, computedSubtotal - discount + deliveryFee);
    const authoritativeTotalString = `₹${Math.round(calculatedTotal)}`;

    orderData.items = sanitizedItems;
    orderData.total = authoritativeTotalString;
    orderData.status = 'accepted';
    orderData.statusLabel = 'Accepted';
    orderData.stepIndex = 0;

    const list = this.getOrders();
    list.unshift(orderData);
    this.saveOrders(list, { action: 'new_order', order: orderData, timestamp: Date.now() });

    // Explicit localStorage trigger for cross-tab storage event with full order payload
    try {
      localStorage.setItem('quickbite_latest_incoming_order', JSON.stringify({
        ...orderData,
        order: orderData,
        timestamp: Date.now()
      }));
    } catch {}

    // Direct clean insertion to Supabase cloud database
    const cleanPayload = {
      id: orderData.id,
      created_at: Number(orderData.createdAt) || Date.now(),
      customer_name: orderData.customerName || 'Online Guest',
      customer_phone: orderData.customerPhone || orderData.phone || null,
      customer_email: orderData.customerEmail || null,
      user_id: orderData.userId || null,
      delivery_address: orderData.deliveryAddress || 'Express Delivery',
      pickup_code: orderData.pickupCode || null,
      payment_method: orderData.paymentMethod || 'Cash on Delivery (COD)',
      payment_status: orderData.paymentStatus || 'Cash on Delivery',
      step_index: typeof orderData.stepIndex === 'number' ? orderData.stepIndex : 0,
      status: orderData.status || 'accepted',
      status_label: orderData.statusLabel || 'Accepted',
      eta: orderData.eta || '25 - 35 Minutes',
      items_summary: orderData.itemsSummary || '',
      items: orderData.items || [],
      total: orderData.total || '₹0',
      lat: (orderData.lat !== undefined && !isNaN(Number(orderData.lat))) ? Number(orderData.lat) : (orderData.addressDetails?.lat ? Number(orderData.addressDetails.lat) : null),
      lng: (orderData.lng !== undefined && !isNaN(Number(orderData.lng))) ? Number(orderData.lng) : (orderData.addressDetails?.lng ? Number(orderData.addressDetails.lng) : null),
      address_details: orderData.addressDetails || null
    };

    try {
      const { data, error } = await supabase.from('orders').insert([cleanPayload]).select('tracking_token');
      if (error) {
        console.warn('[Supabase] addOrder insert error:', error.message);
        return { success: false, error };
      } else {
        if (data && data[0]?.tracking_token) {
          orderData.trackingToken = data[0].tracking_token;
          try {
            const tokens = JSON.parse(localStorage.getItem('quickbite_tracking_tokens') || '{}');
            tokens[orderData.id] = data[0].tracking_token;
            localStorage.setItem('quickbite_tracking_tokens', JSON.stringify(tokens));
          } catch {}
        }
        console.log('[Supabase] addOrder saved to cloud database:', orderData.id);
      }
    } catch (err) {
      console.warn('[Supabase] addOrder exception:', err);
      return { success: false, error: err };
    }

    // Broadcast across devices using Supabase Realtime channel if available
    try {
      if (this.sharedBroadcastChannel) {
        this.sharedBroadcastChannel.send({
          type: 'broadcast',
          event: 'new_order',
          payload: { order: orderData, timestamp: Date.now() }
        });
      }
    } catch {}

    return {
      success: true,
      id: orderData.id,
      trackingToken: orderData.trackingToken,
      ...orderData
    };
  }

  updateOrderStatus(orderId, newStatus, source = 'admin', extraData = {}) {
    if (typeof source === 'object' && source !== null) {
      extraData = source;
      source = 'admin';
    }
    const list = this.getOrders();
    const norm = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanTarget = norm(orderId);
    const order = list.find(o => o && norm(o.id) === cleanTarget);
    if (!order) {
      console.warn(`[DataService] Order not found for updateOrderStatus: ${orderId}`);
      return null;
    }

    // Order Cancellation handling
    if (newStatus === 'cancelled') {
      if (['cooking', 'ready_for_pickup', 'on_the_way', 'delivered'].includes(order.status)) {
        console.warn(`[DataService] Action blocked: Order ${orderId} cannot be cancelled once kitchen preparation has begun (current status: ${order.status}).`);
        return null;
      }
      if (order.status === 'delivered') {
        console.warn(`[DataService] Action blocked: Order ${orderId} has already been delivered.`);
        return null;
      }
      if (source === 'customer' && order.status !== 'accepted') {
        console.warn(`[DataService] Action blocked: Customer can only cancel orders in 'accepted' status. Current status: ${order.status}`);
        return null;
      }
      const prevStatus = order.status;
      order.status = 'cancelled';
      order.stepIndex = -1;
      order.statusLabel = 'Cancelled';
      order.eta = 'Order Cancelled';
      order.cancelledAt = Date.now();
      if (extraData?.cancellationReason) {
        order.cancellationReason = extraData.cancellationReason;
      }
      if (extraData && typeof extraData === 'object') {
        Object.assign(order, extraData);
      }
      this.saveOrders(list, { action: 'status_updated', orderId, order, prevStatus, source, timestamp: Date.now() });

      try {
        localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
          orderId: order.id,
          status: 'cancelled',
          prevStatus,
          statusLabel: 'Cancelled',
          stepIndex: -1,
          eta: 'Order Cancelled',
          cancellationReason: order.cancellationReason,
          order,
          source,
          timestamp: Date.now()
        }));
      } catch {}

      if (supabase) {
        const cleanId = String(orderId || '').replace(/^#/, '');
        const hashId = `#${cleanId}`;
        const basePayload = {
          status: 'cancelled',
          step_index: -1,
          status_label: 'Cancelled',
          eta: 'Cancelled'
        };
        const fullPayload = {
          ...basePayload,
          cancellation_reason: order.cancellationReason || null
        };

        const doUpdate = async (targetId) => {
          if (!targetId) return;
          try {
            const { error } = await supabase.from('orders').update(fullPayload).eq('id', targetId);
            if (error) {
              await supabase.from('orders').update(basePayload).eq('id', targetId);
            }
          } catch {}
        };

        doUpdate(order.id);
        if (order.id !== cleanId) doUpdate(cleanId);
        if (order.id !== hashId) doUpdate(hashId);
      }
      return order;
    }

    // PIPELINE STATUS RANKINGS (Strictly monotonic & irreversible)
    // 0: Accepted -> 1: Preparing -> 2: Ready to Dispatch -> 3: Dispatched -> 4: Delivered
    const STATUS_RANKS = {
      'pending': -1, // Backwards compatibility for legacy orders
      'accepted': 0,
      'cooking': 1,
      'ready_for_pickup': 2,
      'on_the_way': 3,
      'delivered': 4
    };

    const currentRank = STATUS_RANKS[order.status] !== undefined ? STATUS_RANKS[order.status] : 0;
    const targetRank = STATUS_RANKS[newStatus] !== undefined ? STATUS_RANKS[newStatus] : -1;

    // STRICT RULE: Once passed, order status CANNOT be reversed or set backwards
    if (targetRank <= currentRank) {
      console.warn(`[DataService] Action blocked: Order ${orderId} is currently "${order.status}" (step ${currentRank}). Status pipeline is permanent and cannot be reversed to "${newStatus}" (step ${targetRank}).`);
      return null;
    }

    // STRICT POLICY: Only the Delivery Boy / Rider can pick up ('on_the_way') and deliver ('delivered')!
    if ((newStatus === 'on_the_way' || newStatus === 'delivered') && source !== 'rider') {
      console.warn(`[DataService] Action blocked: Order ${orderId} status "${newStatus}" cannot be set by ${source}. Only the Delivery Partner can pick up and deliver.`);
      return null;
    }

    const prevStatus = order.status;
    order.status = newStatus;
    if (newStatus === 'accepted') {
      order.stepIndex = 0;
      order.statusLabel = 'Accepted';
      order.eta = '25 - 35 Minutes';
    } else if (newStatus === 'cooking') {
      order.stepIndex = 1;
      order.statusLabel = 'Preparing';
      order.eta = '15 - 20 Minutes';
    } else if (newStatus === 'ready_for_pickup') {
      order.stepIndex = 2;
      order.statusLabel = 'Ready to Dispatch';
      order.eta = '10 - 15 Minutes';
    } else if (newStatus === 'on_the_way') {
      order.stepIndex = 3;
      order.statusLabel = 'Dispatched for Delivery';
      order.eta = '5 - 10 Minutes';
    } else if (newStatus === 'delivered') {
      order.stepIndex = 4;
      order.statusLabel = 'Delivered';
      order.eta = 'Delivered 🎉';
      order.deliveredAt = order.deliveredAt || Date.now();
    }

    if (extraData && typeof extraData === 'object') {
      Object.assign(order, extraData);
    }

    this.saveOrders(list, { action: 'status_updated', orderId, order, prevStatus, source, timestamp: Date.now() });

    try {
      localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
        orderId: order.id,
        status: order.status,
        prevStatus: prevStatus,
        statusLabel: order.statusLabel,
        stepIndex: order.stepIndex,
        eta: order.eta,
        order: order,
        source: source,
        timestamp: Date.now()
      }));
    } catch {}

    // Resilient Supabase database update
    try {
      const cleanId = String(orderId || '').replace(/^#/, '');
      const hashId = `#${cleanId}`;
      const fullPayload = {
        status: order.status,
        step_index: order.stepIndex,
        status_label: order.statusLabel,
        eta: order.eta
      };
      if (order.deliveredAt) fullPayload.delivered_at = Number(order.deliveredAt);
      if (order.assignedRiderPin) fullPayload.assigned_rider_pin = order.assignedRiderPin;
      if (order.assignedRiderName) fullPayload.assigned_rider_name = order.assignedRiderName;
      if (order.assignedRiderPhone) fullPayload.assigned_rider_phone = order.assignedRiderPhone;
      if (typeof extraData?.cashCollected === 'number' || typeof order.cashCollected === 'number' || typeof order.cash_collected === 'number') {
        const cashAmt = typeof extraData?.cashCollected === 'number' ? extraData.cashCollected : (order.cashCollected || order.cash_collected || 0);
        fullPayload.cash_collected = cashAmt;
        order.cashCollected = cashAmt;
        order.cash_collected = cashAmt;
      }

      const basePayload = {
        status: order.status,
        step_index: order.stepIndex,
        status_label: order.statusLabel,
        eta: order.eta
      };

      const doUpdate = async (targetId) => {
        const { error } = await supabase.from('orders').update(fullPayload).eq('id', targetId).in('status', ['accepted', 'cooking', 'ready_for_pickup']);
        if (error) {
          await supabase.from('orders').update(basePayload).eq('id', targetId).in('status', ['accepted', 'cooking', 'ready_for_pickup']);
        }
      };

      doUpdate(orderId).then(() => {
        const altId = orderId.startsWith('#') ? cleanId : hashId;
        doUpdate(altId);
      });
    } catch (err) {}

    return order;
  }

  updateOrder(orderId, updatedOrderData) {
    const list = this.getOrders();
    const idx = list.findIndex(o => o.id === orderId);
    if (idx === -1) return null;

    // PIPELINE STATUS RANKINGS (Strictly monotonic & irreversible)
    const STATUS_RANKS = {
      'pending': -1,
      'accepted': 0,
      'cooking': 1,
      'ready_for_pickup': 2,
      'on_the_way': 3,
      'delivered': 4
    };

    if (updatedOrderData.status) {
      const currentRank = STATUS_RANKS[list[idx].status] !== undefined ? STATUS_RANKS[list[idx].status] : 0;
      const targetRank = STATUS_RANKS[updatedOrderData.status] !== undefined ? STATUS_RANKS[updatedOrderData.status] : -1;

      // STRICT RULE: Once passed, order status CANNOT be reversed or set backwards
      if (targetRank <= currentRank) {
        console.warn(`[DataService] Action blocked in updateOrder: Order ${orderId} is currently "${list[idx].status}" (step ${currentRank}). Status pipeline is permanent and cannot be reversed to "${updatedOrderData.status}" (step ${targetRank}).`);
        delete updatedOrderData.status;
      }
    }

    // STRICT POLICY: Only the Delivery Boy / Rider can pick up ('on_the_way') and deliver ('delivered')!
    if ((updatedOrderData.status === 'on_the_way' || updatedOrderData.status === 'delivered') && updatedOrderData.source !== 'rider') {
      console.warn(`[DataService] Action blocked: Order ${orderId} cannot be dispatched or delivered by admin in updateOrder.`);
      return null;
    }

    const prevStatus = list[idx].status;
    list[idx] = { ...list[idx], ...updatedOrderData };

    if (updatedOrderData.status) {
      const s = updatedOrderData.status;
      if (s === 'pending') {
        list[idx].stepIndex = 0;
        list[idx].statusLabel = 'Pending Approval';
      } else if (s === 'accepted') {
        list[idx].stepIndex = 1;
        list[idx].statusLabel = 'Accepted';
      } else if (s === 'cooking') {
        list[idx].stepIndex = 2;
        list[idx].statusLabel = 'Preparing';
      } else if (s === 'on_the_way') {
        list[idx].stepIndex = 3;
        list[idx].statusLabel = 'On the way';
      } else if (s === 'delivered') {
        list[idx].stepIndex = 4;
        list[idx].statusLabel = 'Delivered';
      }
    }

    this.saveOrders(list, { action: 'status_updated', orderId, order: list[idx], prevStatus, source: updatedOrderData.source || 'admin', timestamp: Date.now() });

    try {
      localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
        orderId: list[idx].id,
        status: list[idx].status,
        prevStatus: prevStatus,
        statusLabel: list[idx].statusLabel,
        stepIndex: list[idx].stepIndex,
        eta: list[idx].eta,
        order: list[idx],
        source: updatedOrderData.source || 'admin',
        timestamp: Date.now()
      }));
    } catch {}

    // Asynchronously update in Supabase
    try {
      const o = list[idx];
      supabase.from('orders').update({
        status: o.status,
        step_index: o.stepIndex,
        status_label: o.statusLabel,
        eta: o.eta,
        customer_name: o.customerName,
        delivery_address: o.deliveryAddress,
        items_summary: o.itemsSummary,
        items: o.items,
        total: o.total
      }).eq('id', orderId).then(({ error }) => {
        if (error) console.warn('[Supabase] updateOrder error:', error.message);
      });
    } catch (e) {}

    return list[idx];
  }

  deleteOrder(orderId) {
    // STRICT RULE: Individual orders are immutable legal & business records and cannot be deleted
    console.warn(`[DataService] Action blocked: Orders are permanent business records and cannot be deleted (Order ID: ${orderId}).`);
    return false;
  }

  clearAllOrders() {
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify([]));
    try {
      localStorage.removeItem('quickbite_my_order_ids');
      localStorage.removeItem('quickbite_order_status_sync');
      localStorage.removeItem('quickbite_acknowledged_alarms');
      localStorage.removeItem('quickbite_last_notified_order');
    } catch {}
    this.notifyChange('orders', { action: 'orders_cleared' });
    return true;
  }

  // --- STORE SETTINGS & RUSH CONTROL ---
  getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const parsed = data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
      
      // Ensure fixed restaurant backend coordinates: 12°43'14.2"N 77°17'12.6"E
      parsed.restaurantLat = RESTAURANT_COORDINATES.lat;
      parsed.restaurantLng = RESTAURANT_COORDINATES.lng;
      // Minimum order value setting (0 = no minimum order limit)
      parsed.minOrderValue = Math.max(0, Number(parsed.minOrderValue !== undefined ? parsed.minOrderValue : (parsed.minOrder ?? 0)));
      parsed.minOrder = parsed.minOrderValue;

      // Auto-expire rush pause if timer elapsed
      if (parsed.isRushPaused && parsed.pauseUntil && Date.now() >= parsed.pauseUntil) {
        parsed.isRushPaused = false;
        parsed.pauseUntil = null;
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
        this.notifyChange('settings');
      }
      return parsed;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings) {
    const phone = settings.restaurantPhone || settings.helpline || DEFAULT_SETTINGS.restaurantPhone;
    // Preserve fixed backend coordinates
    const toSave = {
      ...settings,
      restaurantLat: RESTAURANT_COORDINATES.lat,
      restaurantLng: RESTAURANT_COORDINATES.lng,
      restaurantPhone: phone,
      helpline: phone
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(toSave));
    this.notifyChange('settings', { settings: toSave });
    this.broadcastSettings(toSave);
    return this.syncSettingsToSupabase(toSave);
  }

  setRushPause(minutes, reason = 'High kitchen rush — orders temporarily paused') {
    const current = this.getSettings();
    const pauseUntil = Date.now() + minutes * 60 * 1000;
    const updated = {
      ...current,
      isRushPaused: true,
      pauseMinutes: minutes,
      pauseUntil: pauseUntil,
      pauseReason: reason
    };
    this.saveSettings(updated);
    return updated;
  }

  extendRushPause(additionalMinutes = 10) {
    const current = this.getSettings();
    const baseTime = (current.isRushPaused && current.pauseUntil && current.pauseUntil > Date.now())
      ? current.pauseUntil
      : Date.now();
    const newPauseUntil = baseTime + additionalMinutes * 60 * 1000;
    const remainingMins = Math.max(1, Math.round((newPauseUntil - Date.now()) / 60000));
    const updated = {
      ...current,
      isRushPaused: true,
      pauseMinutes: remainingMins,
      pauseUntil: newPauseUntil
    };
    this.saveSettings(updated);
    return updated;
  }

  isStoreOpen() {
    const s = this.getSettings();
    return s.storeOpen !== false;
  }

  setStoreOpen(isOpen, closedReason = null) {
    const current = this.getSettings();
    const updated = {
      ...current,
      storeOpen: Boolean(isOpen),
      ...(closedReason ? { storeClosedReason: String(closedReason).trim() } : {})
    };
    this.saveSettings(updated);
    return updated;
  }

  resumeOrders() {
    const current = this.getSettings();
    const updated = {
      ...current,
      isRushPaused: false,
      pauseUntil: null
    };
    this.saveSettings(updated);
    return updated;
  }

  setDeliveryRadius(km) {
    const current = this.getSettings();
    const updated = {
      ...current,
      restaurantLat: RESTAURANT_COORDINATES.lat,
      restaurantLng: RESTAURANT_COORDINATES.lng,
      deliveryRadiusKm: Math.max(1, Math.min(100, Number(km) || 7))
    };
    this.saveSettings(updated);
    return updated;
  }

  // --- RESTAURANT BACKEND COORDINATES & ROAD ROUTING ENGINE ---
  getRestaurantCoordinates() {
    return RESTAURANT_COORDINATES;
  }

  // Straight aerial Haversine distance in kilometers from restaurant backend anchor
  calculateStraightDistance(userLat, userLng) {
    const numLat = Number(userLat);
    const numLng = Number(userLng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || (numLat === 0 && numLng === 0)) return null;
    const R = 6371; // Earth's mean radius in km
    const dLat = (numLat - RESTAURANT_COORDINATES.lat) * (Math.PI / 180);
    const dLng = (numLng - RESTAURANT_COORDINATES.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(RESTAURANT_COORDINATES.lat * (Math.PI / 180)) *
      Math.cos(numLat * (Math.PI / 180)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  // Synchronous road network distance in KM using calibrated urban street routing factor (1.35x)
  calculateRoadDistanceSync(userLat, userLng) {
    const straight = this.calculateStraightDistance(userLat, userLng);
    if (straight === null) return null;
    return Math.round(straight * 1.35 * 10) / 10;
  }

  // Main distance calculation: returns actual road network distance (matching Google Maps driving routes)
  calculateDistanceToRestaurant(userLat, userLng) {
    return this.calculateRoadDistanceSync(userLat, userLng);
  }

  // Asynchronous real-time road routing via Open Source Routing Machine (OSRM)
  // Calculates exact street path (e.g. Railway Station Road), turn distance in meters, and bike travel duration
  async calculateRoadRoute(userLat, userLng) {
    const numLat = Number(userLat);
    const numLng = Number(userLng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || (numLat === 0 && numLng === 0)) {
      return null;
    }

    const cacheKey = `sb_road_route_${numLat.toFixed(4)}_${numLng.toFixed(4)}`;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.distanceMeters === 'number') {
            return parsed;
          }
        }
      }
    } catch {}

    const straightKm = this.calculateStraightDistance(numLat, numLng) || 0.7;
    const syncRoadKm = Math.round(straightKm * 1.35 * 10) / 10;
    const syncMeters = Math.round(syncRoadKm * 1000);
    const syncDurationMins = Math.max(3, Math.round(syncRoadKm * 3.5));

    const fallbackResult = {
      distanceKm: syncRoadKm,
      distanceMeters: syncMeters,
      durationMins: syncDurationMins,
      distanceDisplay: syncMeters < 1000 ? `${syncMeters} m` : `${syncRoadKm} km`,
      source: 'calibrated_road'
    };

    try {
      if (typeof fetch !== 'undefined') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const rest = RESTAURANT_COORDINATES;
        const url = `https://router.project-osrm.org/route/v1/driving/${rest.lng},${rest.lat};${numLng},${numLat}?overview=false`;

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
            const route = data.routes[0];
            const roadMeters = Math.round(route.distance);
            const roadKm = Math.round((roadMeters / 1000) * 10) / 10;
            // Realistic two-wheeler duration including road turns / intersections
            const durationMins = Math.max(3, Math.round(route.duration / 60) + 1);

            const result = {
              distanceKm: roadKm,
              distanceMeters: roadMeters,
              durationMins: durationMins,
              distanceDisplay: roadMeters < 1000 ? `${Math.round(roadMeters / 10) * 10} m` : `${roadKm} km`,
              source: 'osrm_live_road'
            };

            try {
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem(cacheKey, JSON.stringify(result));
              }
            } catch {}

            return result;
          }
        }
      }
    } catch (e) {
      // Fallback returned safely
    }

    return fallbackResult;
  }

  // Check if a customer location is within current admin-adjusted KM radius (fails closed on unpinned/invalid coordinates)
  checkDeliveryAvailability(userLat, userLng) {
    const radius = Number(this.getSettings().deliveryRadiusKm || 7);
    const numLat = Number(userLat);
    const numLng = Number(userLng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || (numLat === 0 && numLng === 0)) {
      return {
        deliverable: false,
        distanceKm: null,
        maxRadiusKm: radius,
        reason: 'unpinned'
      };
    }
    const distance = this.calculateDistanceToRestaurant(numLat, numLng);
    if (distance === null) {
      return {
        deliverable: false,
        distanceKm: null,
        maxRadiusKm: radius,
        reason: 'unpinned'
      };
    }
    return {
      deliverable: distance <= radius,
      distanceKm: distance,
      maxRadiusKm: radius,
      reason: distance <= radius ? 'in_zone' : 'out_of_zone'
    };
  }

  setOffer(offerData) {
    const current = this.getSettings();
    const discountType = offerData.offerDiscountType === 'flat' ? 'flat' : 'percent';
    const updated = {
      ...current,
      offerActive: Boolean(offerData.offerActive !== false),
      offerCode: (offerData.offerCode || 'CRISPY20').trim().toUpperCase(),
      offerDiscountType: discountType,
      offerDiscountPercent: Math.max(1, Math.min(100, Number(offerData.offerDiscountPercent || 20))),
      offerDiscountAmount: Math.max(1, Number(offerData.offerDiscountAmount || 100)),
      offerMinOrder: Math.max(0, Number(offerData.offerMinOrder || 0)),
      offerTitle: offerData.offerTitle || 'Craving Savera Paradise? Get Special Discount Today!',
      offerSubtext: offerData.offerSubtext || 'Use coupon code at checkout for special discount.',
      offerFreeDelivery: Boolean(offerData.offerFreeDelivery !== false),
      ...(offerData.freeDeliveryEnabled !== undefined && { freeDeliveryEnabled: Boolean(offerData.freeDeliveryEnabled) }),
      ...(offerData.freeDeliveryThreshold !== undefined && { freeDeliveryThreshold: Math.max(0, Number(offerData.freeDeliveryThreshold)) })
    };
    this.saveSettings(updated);
    return updated;
  }

  setDeliverySettings(delivData) {
    const current = this.getSettings();
    const updated = {
      ...current,
      freeDeliveryEnabled: Boolean(delivData.freeDeliveryEnabled !== false),
      freeDeliveryThreshold: Math.max(0, Number(delivData.freeDeliveryThreshold !== undefined ? delivData.freeDeliveryThreshold : (current.freeDeliveryThreshold ?? 250))),
      deliveryFeeStandard: Math.max(0, Number(delivData.deliveryFeeStandard !== undefined ? delivData.deliveryFeeStandard : (current.deliveryFeeStandard ?? 3.99))),
      ...(delivData.minOrderValue !== undefined && {
        minOrderValue: Math.max(0, Math.round(Number(delivData.minOrderValue))),
        minOrder: Math.max(0, Math.round(Number(delivData.minOrderValue)))
      }),
      ...(delivData.deliveryRadiusKm !== undefined && {
        deliveryRadiusKm: Math.max(1, Math.min(100, Number(delivData.deliveryRadiusKm)))
      }),
      ...(delivData.maxActiveOrdersPerCustomer !== undefined && {
        maxActiveOrdersPerCustomer: Math.max(1, Math.min(10, Number(delivData.maxActiveOrdersPerCustomer)))
      })
    };
    this.saveSettings(updated);
    return updated;
  }

  // --- USER ADDRESSES & LOCATION ENGINE ---
  getAllAddressesRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ADDRESSES);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  getUserAddresses(userId = null, userEmail = null) {
    try {
      const list = this.getAllAddressesRaw();
      if (!Array.isArray(list) || list.length === 0) return [];

      const cleanEmail = (userEmail || '').trim().toLowerCase();
      const safeUserId = (userId || '').trim();

      // If user info is available (logged in / identified customer):
      if (safeUserId || cleanEmail) {
        let userAddrs = list.filter(a => {
          if (safeUserId && a.userId && a.userId === safeUserId) return true;
          if (cleanEmail && a.userEmail && a.userEmail.toLowerCase() === cleanEmail) return true;
          return false;
        });

        // AUTO-ADOPT: Automatically claim any unassigned / guest addresses saved on this device
        let hasAdoptions = false;
        list.forEach(a => {
          if (!a.userId && !a.userEmail) {
            a.userId = safeUserId || a.userId;
            a.userEmail = cleanEmail || a.userEmail;
            hasAdoptions = true;
            if (!userAddrs.some(m => m.id === a.id)) {
              userAddrs.push(a);
            }
          }
        });

        if (hasAdoptions) {
          try {
            localStorage.setItem(STORAGE_KEYS.ADDRESSES, JSON.stringify(list));
            userAddrs.forEach(addr => this.syncSingleAddressToSupabase(addr));
          } catch (e) {}
        }

        // SAFETY NET: If user has 0 matching addresses, but this device has saved addresses,
        // never show 0 / erased to the customer! Return the local addresses.
        if (userAddrs.length === 0 && list.length > 0) {
          return list;
        }

        return userAddrs;
      }

      // Guest mode (unauthenticated or initial page load before auth finishes)
      const guestAddrs = list.filter(a => !a.userId && !a.userEmail);
      return guestAddrs.length > 0 ? guestAddrs : list;
    } catch {
      return [];
    }
  }

  async syncSingleAddressToSupabase(addr) {
    if (!addr || !addr.id || !supabase) return;
    try {
      const payload = {
        id: String(addr.id),
        user_id: addr.userId ? String(addr.userId) : null,
        user_email: addr.userEmail ? String(addr.userEmail).toLowerCase() : null,
        name: addr.name || 'Customer',
        phone: addr.phone || '',
        tag: addr.tag || 'Home',
        flat_no: (addr.details || addr.flatNo || 'Pinned Doorstep').slice(0, 100),
        area: addr.details || addr.area || 'Ramanagara',
        city: addr.city || 'Ramanagara',
        pincode: addr.pincode || '',
        lat: Number(addr.lat) || RESTAURANT_COORDINATES.lat,
        lng: Number(addr.lng) || RESTAURANT_COORDINATES.lng,
        distance_km: Number(addr.distanceKm) || 0,
        is_default: Boolean(addr.isDefault)
      };

      const { error } = await supabase
        .from('user_addresses')
        .upsert([payload], { onConflict: 'id' });

      if (error && !error.message?.includes('schema cache') && !error.message?.includes('does not exist')) {
        console.warn('[DataService] Supabase user_addresses upsert error:', error.message);
      }
    } catch (err) {
      console.warn('[DataService] syncSingleAddressToSupabase exception:', err);
    }
  }

  saveUserAddress(addressData) {
    const list = this.getAllAddressesRaw();
    const id = addressData.id || `addr_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const lat = Number(addressData.lat) || RESTAURANT_COORDINATES.lat;
    const lng = Number(addressData.lng) || RESTAURANT_COORDINATES.lng;
    const distanceKm = this.calculateDistanceToRestaurant(lat, lng) ?? 0;

    const userAddresses = this.getUserAddresses(addressData.userId, addressData.userEmail);
    const isFirst = userAddresses.length === 0;
    const isDefault = addressData.isDefault || isFirst;

    const newAddress = {
      id,
      userId: addressData.userId || null,
      userEmail: (addressData.userEmail || '').trim().toLowerCase() || null,
      name: (addressData.name || '').trim(),
      phone: (addressData.phone || '').trim(),
      tag: addressData.tag || 'Home',
      flatNo: (addressData.flatNo || '').trim(),
      area: (addressData.area || '').trim(),
      city: (addressData.city || '').trim(),
      pincode: (addressData.pincode || '').trim(),
      details: (addressData.details || addressData.fullText || `${addressData.flatNo || ''}, ${addressData.area || ''}`).trim(),
      fullText: (addressData.fullText || addressData.details || `${addressData.flatNo || ''}, ${addressData.area || ''}`).trim(),
      lat,
      lng,
      distanceKm: Number(distanceKm) || 0,
      isDefault: Boolean(isDefault),
      updatedAt: Date.now()
    };

    // If marked default, unset defaults for this user
    let updatedList = list.map(a => {
      const isThisUser = (newAddress.userId && a.userId === newAddress.userId) ||
                         (newAddress.userEmail && a.userEmail && a.userEmail.toLowerCase() === newAddress.userEmail);
      if (isDefault && isThisUser) {
        return { ...a, isDefault: false };
      }
      return a;
    });

    const existingIdx = updatedList.findIndex(a => a.id === id);
    if (existingIdx >= 0) {
      updatedList[existingIdx] = newAddress;
    } else {
      updatedList.push(newAddress);
    }

    try {
      localStorage.setItem(STORAGE_KEYS.ADDRESSES, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Could not save address to localStorage:', e);
    }

    // Two-way sync to Supabase
    this.syncSingleAddressToSupabase(newAddress);

    // Notify listeners across all tabs
    this.notifyChange('addresses', { action: 'saved', address: newAddress });

    return newAddress;
  }

  deleteUserAddress(addressId, userId = null, userEmail = null) {
    let list = this.getAllAddressesRaw();
    const cleanEmail = (userEmail || '').trim().toLowerCase();

    const target = list.find(a => a.id === addressId);
    const wasDefault = target?.isDefault;

    list = list.filter(a => a.id !== addressId);

    // If deleted address was default, set next address of THIS user as default
    if (wasDefault) {
      const remainingUserAddrs = list.filter(a => {
        if (userId && a.userId === userId) return true;
        if (cleanEmail && a.userEmail && a.userEmail.toLowerCase() === cleanEmail) return true;
        return false;
      });
      if (remainingUserAddrs.length > 0) {
        const nextId = remainingUserAddrs[0].id;
        list = list.map(a => a.id === nextId ? { ...a, isDefault: true } : a);
      }
    }

    try {
      localStorage.setItem(STORAGE_KEYS.ADDRESSES, JSON.stringify(list));
    } catch (e) {
      console.warn('Could not update addresses in localStorage:', e);
    }

    // Also remove from Supabase
    try {
      supabase.from('user_addresses').delete().eq('id', addressId).then(({ error }) => {
        if (error && !error.message?.includes('schema cache') && !error.message?.includes('does not exist')) {
          console.warn('Supabase address delete:', error.message);
        }
      });
    } catch {}

    this.notifyChange('addresses', { action: 'deleted', addressId });

    return this.getUserAddresses(userId, userEmail);
  }

  setDefaultAddress(addressId, userId = null, userEmail = null) {
    const list = this.getAllAddressesRaw();
    const cleanEmail = (userEmail || '').trim().toLowerCase();

    const updatedList = list.map(a => {
      const isThisUser = (userId && a.userId === userId) ||
                         (cleanEmail && a.userEmail && a.userEmail.toLowerCase() === cleanEmail);
      if (isThisUser) {
        return { ...a, isDefault: a.id === addressId };
      }
      return a;
    });

    try {
      localStorage.setItem(STORAGE_KEYS.ADDRESSES, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Could not update default address in localStorage:', e);
    }

    // Sync default state to Supabase
    try {
      const safeUserId = userId ? String(userId).replace(/[^a-zA-Z0-9_\-]/g, '') : '';
      const safeEmail = cleanEmail ? String(cleanEmail).replace(/[^\w@.-]/g, '') : '';
      const filters = [];
      if (safeUserId) filters.push(`user_id.eq.${safeUserId}`);
      if (safeEmail) filters.push(`user_email.eq.${safeEmail}`);

      if (filters.length > 0) {
        supabase.from('user_addresses').update({ is_default: false }).or(filters.join(',')).then(() => {
          supabase.from('user_addresses').update({ is_default: true }).eq('id', addressId);
        });
      } else {
        supabase.from('user_addresses').update({ is_default: true }).eq('id', addressId);
      }
    } catch {}

    this.notifyChange('addresses', { action: 'set_default', addressId });

    return this.getUserAddresses(userId, userEmail);
  }

  // Fetch addresses from Supabase for this logged-in account and merge with local
  async syncUserAddressesFromSupabase(userId, userEmail) {
    const cleanEmail = (userEmail || '').trim().toLowerCase();
    const safeUserId = (userId || '').trim();

    // PRIVACY GUARD: Never query cloud addresses without an authentic customer identifier
    if (!safeUserId && !cleanEmail) {
      return this.getAllAddressesRaw();
    }

    try {
      let query = supabase.from('user_addresses').select('*');
      if (safeUserId && cleanEmail) {
        query = query.or(`user_id.eq.${safeUserId},user_email.eq.${cleanEmail}`);
      } else if (safeUserId) {
        query = query.eq('user_id', safeUserId);
      } else if (cleanEmail) {
        query = query.eq('user_email', cleanEmail);
      }

      const { data, error } = await query;
      let localList = this.getAllAddressesRaw();

      if (!error && Array.isArray(data) && data.length > 0) {
        data.forEach(row => {
          const cloudAddr = {
            id: row.id,
            userId: row.user_id || safeUserId || null,
            userEmail: (row.user_email || cleanEmail || '').toLowerCase(),
            name: row.name,
            phone: row.phone,
            tag: row.tag || 'Home',
            flatNo: row.flat_no,
            area: row.area,
            city: row.city || 'Ramanagara',
            pincode: row.pincode || '',
            details: row.area || row.flat_no || 'Doorstep Delivery',
            fullText: row.area || row.flat_no || 'Doorstep Delivery',
            lat: Number(row.lat) || RESTAURANT_COORDINATES.lat,
            lng: Number(row.lng) || RESTAURANT_COORDINATES.lng,
            distanceKm: Number(row.distance_km) || 0,
            isDefault: Boolean(row.is_default),
            updatedAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          };

          const idx = localList.findIndex(a => a.id === cloudAddr.id);
          if (idx >= 0) {
            localList[idx] = { ...localList[idx], ...cloudAddr };
          } else {
            localList.push(cloudAddr);
          }
        });

        try {
          localStorage.setItem(STORAGE_KEYS.ADDRESSES, JSON.stringify(localList));
        } catch (e) {}
      }

      // TWO-WAY CLOUD BACKUP: Ensure all local addresses for this user exist in Supabase
      const userAddrs = this.getUserAddresses(safeUserId, cleanEmail);
      userAddrs.forEach(addr => {
        this.syncSingleAddressToSupabase(addr);
      });

      return userAddrs;
    } catch (e) {
      console.warn('[DataService] Could not sync user addresses from Supabase:', e);
      return this.getUserAddresses(userId, userEmail);
    }
  }

  // ========================================================
  // MULTI-RIDER FLEET MANAGEMENT & 4-DIGIT BAG PICKUP CODE
  // ========================================================

  getRiders() {
    try {
      const raw = localStorage.getItem('quickbite_riders');
      let riders = [];
      if (!raw) {
        riders = [];
        localStorage.setItem('quickbite_riders', JSON.stringify([]));
      } else {
        const parsed = JSON.parse(raw);
        riders = Array.isArray(parsed) ? parsed : [];
      }

      // Purge legacy hardcoded default dummy riders (2233, 4455, 8811 from initial seed)
      const purgeKey = localStorage.getItem('quickbite_riders_version');
      if (purgeKey !== 'savera_paradise_fleet_v2') {
        riders = riders.filter(r => {
          const pin = String(r?.pin || '').trim();
          const isLegacyDummy = (pin === '2233' && r?.name === 'Syed Imran') ||
                                (pin === '4455' && r?.name === 'Rahul Kumar') ||
                                (pin === '8811' && r?.name === 'Arif Khan');
          return !isLegacyDummy;
        });
        localStorage.setItem('quickbite_riders', JSON.stringify(riders));
        localStorage.setItem('quickbite_riders_version', 'savera_paradise_fleet_v2');
      }

      // Sanitize riders (clean broken image URLs mistakenly saved as name/avatar)
      let needsResave = false;
      riders = riders.map(r => {
        let avatar = r.avatar || '🏍️';
        if (avatar.startsWith('http')) {
          avatar = (r.vehicle && r.vehicle.includes('Scooter')) ? '🛵' : '🏍️';
          needsResave = true;
        }
        let avatarImg = r.avatarImg || '/avatars/rider-1.svg';
        if (avatarImg.includes('unsplash.com')) {
          avatarImg = '/avatars/rider-1.svg';
          needsResave = true;
        }
        let name = String(r.name || `Rider ${r.pin}`).replace(/^https?:\/\/[^\s]+/, '').trim();
        if (!name) name = `Rider ${r.pin}`;
        if (name !== r.name) needsResave = true;
        return {
          ...r,
          name,
          avatar,
          avatarImg,
          phone: r.phone || '',
          vehicle: r.vehicle || '🏍️ Bike'
        };
      });

      if (needsResave) {
        localStorage.setItem('quickbite_riders', JSON.stringify(riders));
      }
      return riders;
    } catch {
      return [];
    }
  }

  async syncRidersFromSupabase() {
    try {
      if (!supabase) return this.getRiders();
      const { data, error } = await supabase
        .from('riders')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        const localList = this.getRiders();
        const localMap = new Map(localList.map(r => [r.pin, r]));
        data.forEach(r => {
          const pin = String(r.pin).trim();
          const existing = localMap.get(pin);
          localMap.set(pin, {
            ...(existing || {}),
            pin,
            id: r.id || `rider-${pin}`,
            name: r.name || existing?.name || `Rider ${pin}`,
            phone: r.phone || existing?.phone || '',
            vehicle: r.vehicle || existing?.vehicle || '🏍️ Bike',
            status: r.status || existing?.status || 'online',
            avatar: r.avatar || (r.vehicle?.includes('Scooter') ? '🛵' : '🏍️'),
            avatarImg: r.avatar_img || existing?.avatarImg || '/avatars/rider-1.svg',
            cashSettledAt: r.cash_settled_at || existing?.cashSettledAt || null
          });
        });
        const mapped = Array.from(localMap.values());
        localStorage.setItem('quickbite_riders', JSON.stringify(mapped));
        this.notifyChange('riders', { action: 'sync_riders', source: 'supabase' });
        return mapped;
      }

      // Schema-resilient Cloud Fallback: Load from store_settings row 'riders_roster'
      const { data: rosterRow } = await supabase
        .from('store_settings')
        .select('settings')
        .eq('id', 'riders_roster')
        .maybeSingle();

      if (rosterRow && rosterRow.settings && Array.isArray(rosterRow.settings.roster) && rosterRow.settings.roster.length > 0) {
        const localList = this.getRiders();
        const localMap = new Map(localList.map(r => [r.pin, r]));
        rosterRow.settings.roster.forEach(r => {
          if (!r || !r.pin) return;
          const pin = String(r.pin).trim();
          const existing = localMap.get(pin);
          localMap.set(pin, { ...(existing || {}), ...r });
        });
        const mapped = Array.from(localMap.values());
        localStorage.setItem('quickbite_riders', JSON.stringify(mapped));
        this.notifyChange('riders', { action: 'sync_riders', source: 'supabase_settings' });
        return mapped;
      }
    } catch (err) {
      console.warn('[DataService] syncRidersFromSupabase error:', err);
    }
    return this.getRiders();
  }

  saveRiders(riders) {
    try {
      localStorage.setItem('quickbite_riders', JSON.stringify(riders));
      this.notifyChange('riders', { action: 'update_riders', timestamp: Date.now() });

      // Two-way Cloud Backup to Supabase store_settings
      if (supabase && Array.isArray(riders)) {
        supabase.from('store_settings').upsert({
          id: 'riders_roster',
          settings: { roster: riders, updatedAt: Date.now() },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' }).then(() => {}, () => {});
      }
    } catch (e) {
      console.warn('Could not save riders:', e);
    }
  }

  getRiderByPin(pin) {
    if (!pin) return null;
    const cleanPin = String(pin).trim();
    const riders = this.getRiders();
    return riders.find(r => r.pin === cleanPin) || null;
  }

  saveOrUpdateRider(riderData) {
    if (!riderData || !riderData.pin) return null;
    const pin = String(riderData.pin).trim();
    const riders = this.getRiders();
    const idx = riders.findIndex(r => r.pin === pin);
    const existing = idx >= 0 ? riders[idx] : null;

    const vehicle = riderData.vehicle || existing?.vehicle || '🏍️ Bike';
    const avatarEmoji = vehicle.includes('Scooter') ? '🛵' : (vehicle.includes('Car') ? '🚗' : '🏍️');

    const updatedRider = {
      pin,
      id: existing?.id || `rider-${pin}`,
      name: (riderData.name || existing?.name || `Rider ${pin}`).trim(),
      phone: riderData.phone !== undefined ? String(riderData.phone).trim() : (existing?.phone || ''),
      vehicle,
      status: riderData.status || existing?.status || 'online',
      avatar: riderData.avatar && !riderData.avatar.startsWith('http') ? riderData.avatar : avatarEmoji,
      avatarImg: riderData.avatarImg || existing?.avatarImg || '/avatars/rider-1.svg',
      cashSettledAt: riderData.cashSettledAt !== undefined ? riderData.cashSettledAt : (existing?.cashSettledAt || null)
    };

    if (idx >= 0) {
      riders[idx] = updatedRider;
    } else {
      riders.push(updatedRider);
    }
    this.saveRiders(riders);
    this.notifyChange('rider_session', { pin: updatedRider.pin, rider: updatedRider, timestamp: Date.now() });

    // Sync to Supabase Cloud
    if (supabase) {
      supabase.from('riders').upsert([{
        pin: updatedRider.pin,
        id: updatedRider.id,
        name: updatedRider.name,
        phone: updatedRider.phone,
        vehicle: updatedRider.vehicle,
        status: updatedRider.status,
        avatar: updatedRider.avatar,
        avatar_img: updatedRider.avatarImg,
        cash_settled_at: updatedRider.cashSettledAt
      }], { onConflict: 'pin' }).then(({ error }) => {
        if (error) console.warn('[DataService] saveOrUpdateRider supabase error:', error.message);
      }, (err) => {
        console.warn('[DataService] saveOrUpdateRider supabase exception:', err);
      });
    }

    return updatedRider;
  }

  deleteRider(pin) {
    if (!pin) return false;
    const cleanPin = String(pin).trim();
    const riders = this.getRiders();
    const filtered = riders.filter(r => r.pin !== cleanPin);
    if (filtered.length === riders.length) return false;
    this.saveRiders(filtered);

    // If active session was for this deleted rider, clear it
    try {
      if (localStorage.getItem('quickbite_active_rider_pin') === cleanPin) {
        localStorage.removeItem('quickbite_active_rider_pin');
        sessionStorage.removeItem('quickbite_rider_session_auth');
      }
    } catch {}

    this.notifyChange('riders', { action: 'delete_rider', pin: cleanPin, timestamp: Date.now() });

    // Sync deletion to Supabase Cloud
    if (supabase) {
      supabase.from('riders').delete().eq('pin', cleanPin).then(({ error }) => {
        if (error) console.warn('[DataService] deleteRider supabase error:', error.message);
      }, (err) => {
        console.warn('[DataService] deleteRider supabase exception:', err);
      });
    }

    return true;
  }

  getActiveRider() {
    try {
      const activePin = localStorage.getItem('quickbite_active_rider_pin');
      if (!activePin) return null;
      return this.getRiderByPin(activePin) || null;
    } catch {
      return null;
    }
  }

  setActiveRiderPin(pin) {
    try {
      const cleanPin = String(pin).trim();
      const rider = this.getRiderByPin(cleanPin);
      if (!rider) return null;
      localStorage.setItem('quickbite_active_rider_pin', cleanPin);
      this.notifyChange('rider_session', { pin: cleanPin, rider, timestamp: Date.now() });
      return rider;
    } catch {
      return null;
    }
  }

  generateUniqueRiderPin() {
    const existing = this.getRiders();
    const usedPins = new Set(existing.map(r => String(r.pin).trim()));
    usedPins.add('8899'); // Reserved for admin
    usedPins.add('0000');

    let attempts = 0;
    while (attempts < 1000) {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      if (!usedPins.has(pin)) {
        return pin;
      }
      attempts++;
    }
    for (let i = 1001; i <= 9999; i++) {
      const pin = String(i);
      if (!usedPins.has(pin)) return pin;
    }
    return '5566';
  }

  calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return Math.round(d * 10) / 10;
  }

  findOrderByBagCode(code) {
    if (!code) return null;
    const clean = String(code).trim().replace(/\D/g, '');
    if (!clean) return null;
    const orders = this.getOrders();

    const isMatch = (o) => {
      if (!o || !o.id) return false;
      const orderDigits = String(o.id).replace(/\D/g, '');
      const bagCode = o.pickupCode ? String(o.pickupCode).replace(/\D/g, '') : orderDigits.slice(-4);
      return bagCode === clean || String(o.id) === clean || orderDigits === clean || (clean.length >= 4 && orderDigits.endsWith(clean));
    };

    // Prioritize active/dispatchable orders first so older delivered orders don't mask new bags
    const activeMatch = orders.find(o => isMatch(o) && o.status !== 'delivered' && o.status !== 'cancelled');
    if (activeMatch) return activeMatch;

    return orders.find(isMatch) || null;
  }

  claimOrderByBagCode(code, riderPin) {
    const order = this.findOrderByBagCode(code);
    if (!order) {
      return { success: false, reason: 'not_found', message: `No order found matching 4-digit code "${code}". Please verify the number on the bag.` };
    }

    // Atomic Claim Guards: Prevent claiming already claimed, delivered, or cancelled orders
    if (order.status === 'on_the_way') {
      const riderName = order.assignedRiderName ? `by ${order.assignedRiderName}` : 'by another rider';
      return { success: false, reason: 'already_claimed', message: `Order ${order.id} is already out for delivery ${riderName}.` };
    }
    if (order.status === 'delivered') {
      return { success: false, reason: 'already_delivered', message: `Order ${order.id} has already been delivered.` };
    }
    if (order.status === 'cancelled') {
      return { success: false, reason: 'cancelled', message: `Order ${order.id} was cancelled.` };
    }

    const cleanPin = riderPin ? String(riderPin).trim() : null;
    const rider = (cleanPin ? this.getRiderByPin(cleanPin) : null) || this.getActiveRider();
    if (!rider) {
      return { success: false, reason: 'no_rider', message: 'No active delivery rider session found. Please log in with your Rider PIN.' };
    }

    // Ensure pickupCode is firmly set and matches 4 digits
    const cleanCode = String(code).trim().replace(/\D/g, '');
    order.pickupCode = order.pickupCode || (cleanCode.length === 4 ? cleanCode : String(order.id).replace(/\D/g, '').slice(-4));

    // Assign to this rider and transition to 'on_the_way'
    const prevStatus = order.status || 'ready_for_pickup';
    order.status = 'on_the_way';
    order.stepIndex = 3;
    order.statusLabel = 'Dispatched for Delivery';
    order.eta = '5 - 10 Minutes';
    order.assignedRiderPin = rider.pin;
    order.assignedRiderName = rider.name;
    order.assignedRiderPhone = rider.phone;
    order.assignedRiderVehicle = rider.vehicle;
    order.claimedAt = Date.now();

    const normalizeId = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanTargetId = normalizeId(order.id);
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o && normalizeId(o.id) === cleanTargetId);
    if (idx >= 0) {
      orders[idx] = order;
    } else {
      orders.unshift(order);
    }

    this.saveOrders(orders, { action: 'rider_claimed_order', orderId: order.id, riderPin: rider.pin, timestamp: Date.now() });

    try {
      localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
        orderId: order.id,
        status: 'on_the_way',
        prevStatus: prevStatus,
        statusLabel: 'Dispatched for Delivery',
        stepIndex: 3,
        eta: '5 - 10 Minutes',
        order: order,
        source: 'rider',
        timestamp: Date.now()
      }));
    } catch {}

    // Resilient Supabase update: try exact ID, then alternate with/without '#' prefix
    try {
      const cleanId = normalizeId(order.id);
      const hashId = `#${cleanId}`;
      const fullPayload = {
        status: 'on_the_way',
        step_index: 3,
        status_label: 'Dispatched for Delivery',
        eta: '10 - 15 Minutes',
        pickup_code: order.pickupCode || bagCode,
        assigned_rider_pin: rider.pin,
        assigned_rider_name: rider.name,
        assigned_rider_phone: rider.phone,
        assigned_rider_vehicle: rider.vehicle || 'Bike',
        claimed_at: order.claimedAt || Date.now()
      };
      const basePayload = {
        status: 'on_the_way',
        step_index: 3,
        status_label: 'Dispatched for Delivery',
        eta: '10 - 15 Minutes'
      };

      const doUpdate = async (targetId) => {
        const { error } = await supabase.from('orders').update(fullPayload).eq('id', targetId);
        if (error) {
          await supabase.from('orders').update(basePayload).eq('id', targetId);
        }
      };

      doUpdate(order.id).then(() => {
        const altId = order.id.startsWith('#') ? cleanId : hashId;
        doUpdate(altId);
      });
    } catch {}

    return { success: true, order, rider };
  }

  getRiderCashSummary(riderPin) {
    const rider = this.getRiderByPin(riderPin);
    if (!rider) return { cashInHand: 0, deliveredCount: 0, orders: [], codOrders: [] };

    const orders = this.getOrders();
    const settledAt = rider.cashSettledAt ? Number(rider.cashSettledAt) : 0;

    const riderDelivered = orders.filter(o => {
      if (!o || o.status !== 'delivered') return false;
      if (o.assignedRiderPin !== rider.pin) return false;
      const deliveredTime = o.deliveredAt ? Number(o.deliveredAt) : (o.updatedAt ? Number(o.updatedAt) : (o.claimedAt ? Number(o.claimedAt) : 0));
      return deliveredTime > settledAt;
    });

    const codOrders = riderDelivered.filter(o => {
      const pay = String(o.paymentMethod || o.payment_method || '').toLowerCase();
      return pay.includes('cash') || pay.includes('cod') || !o.isPaidOnline;
    });

    const cashInHand = codOrders.reduce((sum, o) => {
      const num = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
      return sum + num;
    }, 0);

    return {
      cashInHand,
      deliveredCount: riderDelivered.length,
      orders: riderDelivered,
      codOrders
    };
  }

  settleRiderCash(riderPin) {
    const riders = this.getRiders();
    const idx = riders.findIndex(r => r.pin === riderPin);
    if (idx >= 0) {
      const settledTime = Date.now();
      riders[idx].cashSettledAt = settledTime;
      this.saveRiders(riders);
      this.notifyChange('cash_settled', { riderPin, settledAt: settledTime });
      return { success: true, settledAt: settledTime, rider: riders[idx] };
    }
    return { success: false };
  }
}

export const dataService = new QuickBiteDataService();


import {collectShopifyLux} from './collect-shopify-lux-assortment.mjs';
await collectShopifyLux('rick',{publish:process.argv.includes('--publish')});

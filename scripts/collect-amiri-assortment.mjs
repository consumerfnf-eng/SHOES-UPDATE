import {collectShopifyLux} from './collect-shopify-lux-assortment.mjs';
await collectShopifyLux('amiri',{publish:process.argv.includes('--publish')});

import Stripe from 'stripe';
import SHIPPING from '../../src/_data/shipping.json';

// MasterTimeWaster API
const PRINTFUL_STORE_ID = 17783389;

// product catalog - matches products.json
const PRODUCTS = {
	'retired-cap': {
		name: 'Retired',
		price: 2700,
		printful_variant_id: 5214014982,
	},
	'weekend-warrior-cap': {
		name: 'Weekend Warrior',
		price: 2700,
		printful_variant_id: 5214014984,
	}
};

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/checkout') {
			return handleCheckout(request, env, url);
		}

		if (request.method === 'POST' && url.pathname === '/checkout') {
			return handleCartCheckout(request, env);
		}

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleWebhook(request, env, ctx);
		}

		return new Response('Not found', { status: 404 });
	}
};

async function handleCheckout(request, env, url) {
	const slug = url.searchParams.get('slug');
	const product = PRODUCTS[slug];

	if (!product) {
		return new Response('Product not found', { status: 404 });
	}

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);

	const session = await stripe.checkout.sessions.create({
		payment_method_types: ['card'],
		line_items: [{
			price_data: {
				currency: 'usd',
				product_data: { name: product.name },
				unit_amount: product.price,
			},
			quantity: 1,
		}],
		mode: 'payment',
		shipping_address_collection: {
			allowed_countries: ['US'],
		},
		shipping_options: [
			{
				shipping_rate_data: {
					type: 'fixed_amount',
					fixed_amount: {
						amount: SHIPPING.base_rate,
						currency: 'usd',
					},
					display_name: SHIPPING.display_name,
					delivery_estimate: SHIPPING.delivery_estimate,
				},
			},
		],
		metadata: {
			slug: slug,
		},
		success_url: `https://mastertimewaster.com/success`,
		cancel_url: `https://mastertimewaster.com/`,
	});

	return Response.redirect(session.url, 303);
}

async function handleCartCheckout(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const { items } = body;
	if (!items || !Array.isArray(items) || items.length === 0) {
		return new Response('No items', { status: 400 });
	}

	for (const item of items) {
		if (!PRODUCTS[item.slug]) {
			return new Response(`Unknown product: ${item.slug}`, { status: 400 });
		}
	}

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);

	const line_items = items.map(item => {
		const product = PRODUCTS[item.slug];
		return {
			price_data: {
				currency: 'usd',
				product_data: { name: product.name },
				unit_amount: product.price,
			},
			quantity: item.qty,
		};
	});

	const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
	const shippingAmount = SHIPPING.base_rate + Math.max(0, totalQty - 1) * SHIPPING.per_additional_item;

	const session = await stripe.checkout.sessions.create({
		payment_method_types: ['card'],
		line_items,
		mode: 'payment',
		shipping_address_collection: {
			allowed_countries: ['US'],
		},
		shipping_options: [
			{
				shipping_rate_data: {
					type: 'fixed_amount',
					fixed_amount: {
						amount: shippingAmount,
						currency: 'usd',
					},
					display_name: SHIPPING.display_name,
					delivery_estimate: SHIPPING.delivery_estimate,
				},
			},
		],
		metadata: {
			items: JSON.stringify(items.map(i => ({ slug: i.slug, qty: i.qty }))),
		},
		success_url: `https://mastertimewaster.com/success`,
		cancel_url: `https://mastertimewaster.com/`,
	});

	return Response.json({ url: session.url });
}

async function handleWebhook(request, env, ctx) {
	const signature = request.headers.get('stripe-signature');
	const body = await request.text();

	let event;
	try {
		const stripe = new Stripe(env.STRIPE_SECRET_KEY);
		event = await stripe.webhooks.constructEventAsync(
			body,
			signature,
			env.STRIPE_WEBHOOK_SECRET
		);
	} catch (err) {
		return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
	}

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object;
		const sessionId = session.id;

		// idempotency check
		const already_processed = await env.ORDERS.get(sessionId);
		if (already_processed) {
			console.log('Already processed session:', sessionId);
			return new Response('OK', { status: 200 });
		}

		// mark as processed before creating order to prevent races
		await env.ORDERS.put(sessionId, 'processed', { expirationTtl: 86400 * 30 });

		ctx.waitUntil(createPrintfulOrder(session, env));
	}

	return new Response('OK', { status: 200 });
}

async function createPrintfulOrder(session, env) {
	const shipping = session.collected_information.shipping_details;

	// Support both cart (items array) and legacy (single slug) metadata formats
	const orderItems = session.metadata.items
		? JSON.parse(session.metadata.items)
		: [{ slug: session.metadata.slug, qty: 1 }];

	const subtotal = orderItems.reduce((sum, item) => {
		const product = PRODUCTS[item.slug];
		return sum + (product.price / 100) * item.qty;
	}, 0);

	const order = {
		recipient: {
			name: shipping.name,
			address1: shipping.address.line1,
			address2: shipping.address.line2 || '',
			city: shipping.address.city,
			state_code: shipping.address.state,
			country_code: shipping.address.country,
			zip: shipping.address.postal_code,
			email: session.customer_details.email,
		},
		items: orderItems.map(item => {
			const product = PRODUCTS[item.slug];
			return {
				sync_variant_id: product.printful_variant_id,
				quantity: item.qty,
				retail_price: (product.price / 100).toFixed(2),
			};
		}),
		retail_costs: {
			currency: 'USD',
			subtotal: subtotal.toFixed(2),
		}
	};

	const response = await fetch(
		`https://api.printful.com/orders?store_id=${PRINTFUL_STORE_ID}`,
		{
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(order),
		}
	);

	const result = await response.json();
	console.log('Printful order result:', JSON.stringify(result, null, 2));

	const orderId = result.result.id;
	const confirmResponse = await fetch(
		`https://api.printful.com/orders/${orderId}/confirm?store_id=${PRINTFUL_STORE_ID}`,
		{
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
				'Content-Type': 'application/json',
			},
		}
	);
	const confirmResult = await confirmResponse.json();
	console.log('Printful confirm result:', confirmResult.result.status);

	return result;
}

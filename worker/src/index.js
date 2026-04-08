import Stripe from 'stripe';

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
			allowed_countries: ['US', 'CA', 'GB', 'AU', 'NZ'],
		},
		shipping_options: [
			{
				shipping_rate_data: {
					type: 'fixed_amount',
					fixed_amount: {
						amount: 449,
						currency: 'usd',
					},
					display_name: 'Standard Shipping',
					delivery_estimate: {
						minimum: { unit: 'business_day', value: 5 },
						maximum: { unit: 'business_day', value: 10 },
					},
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
	const stripe = new Stripe(env.STRIPE_SECRET_KEY);
	const fullSession = await stripe.checkout.sessions.retrieve(session.id);

	const slug = fullSession.metadata.slug;
	const product = PRODUCTS[slug];
	const shipping = fullSession.shipping_details;

	const order = {
		recipient: {
			name: shipping.name,
			address1: shipping.address.line1,
			address2: shipping.address.line2 || '',
			city: shipping.address.city,
			state_code: shipping.address.state,
			country_code: shipping.address.country,
			zip: shipping.address.postal_code,
			email: fullSession.customer_details.email,
		},
		items: [{
			sync_variant_id: product.printful_variant_id,
			quantity: 1,
			retail_price: (product.price / 100).toFixed(2),
		}],
		retail_costs: {
			currency: 'USD',
			subtotal: (product.price / 100).toFixed(2),
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

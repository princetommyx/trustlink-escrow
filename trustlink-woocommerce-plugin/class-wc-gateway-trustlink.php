<?php
if (!defined('ABSPATH')) {
    exit;
}

class WC_Gateway_TrustLink extends WC_Payment_Gateway {

    public function __construct() {
        $this->id = 'trustlink_escrow';
        $this->icon = ''; // Optional URL to an icon
        $this->has_fields = false;
        $this->method_title = 'TrustLink Escrow';
        $this->method_description = 'Allows secure payments via TrustLink Escrow.';

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->api_key = $this->get_option('api_key');
        
        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
    }

    public function init_form_fields() {
        $this->form_fields = array(
            'enabled' => array(
                'title' => 'Enable/Disable',
                'type' => 'checkbox',
                'label' => 'Enable TrustLink Escrow Payment',
                'default' => 'yes'
            ),
            'title' => array(
                'title' => 'Title',
                'type' => 'text',
                'description' => 'This controls the title which the user sees during checkout.',
                'default' => 'TrustLink Escrow (Secure Payment)',
                'desc_tip' => true,
            ),
            'description' => array(
                'title' => 'Description',
                'type' => 'textarea',
                'description' => 'This controls the description which the user sees during checkout.',
                'default' => 'Pay securely via TrustLink. Your funds are held safely until you receive your item.',
            ),
            'api_key' => array(
                'title' => 'TrustLink API Key',
                'type' => 'password',
                'description' => 'Get this from your TrustLink Developer Dashboard.',
                'default' => '',
            ),
            'webhook_info' => array(
                'title' => 'Webhook URL',
                'type' => 'title',
                'description' => 'Copy this URL and paste it into your TrustLink Dashboard: <strong>' . get_rest_url(null, 'trustlink/v1/webhook') . '</strong>',
            )
        );
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);

        if (!$this->api_key) {
            wc_add_notice('Payment error: TrustLink API Key is not configured.', 'error');
            return;
        }

        // TrustLink API Endpoint (Update this to the actual hosted Firebase Function URL when deployed)
        // e.g. https://us-central1-YOUR_PROJECT.cloudfunctions.net/api/v1/escrows
        $api_url = 'https://trustlink.co/api/v1/escrows'; // Placeholder for production API URL

        // Calculate total and details
        $amount = $order->get_total();
        $description = 'Order #' . $order->get_order_number();
        
        $payload = array(
            'amount' => $amount,
            'description' => $description,
            'buyerEmail' => $order->get_billing_email(),
            'buyerPhone' => $order->get_billing_phone(),
            'customReference' => $order_id,
            'redirectUrl' => $this->get_return_url($order),
            'cancelUrl' => $order->get_cancel_order_url()
        );

        $response = wp_remote_post($api_url, array(
            'headers' => array(
                'Content-Type' => 'application/json',
                'x-api-key' => $this->api_key
            ),
            'body' => wp_json_encode($payload),
            'timeout' => 15
        ));

        if (is_wp_error($response)) {
            wc_add_notice('Connection error: Unable to contact TrustLink API.', 'error');
            return;
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (wp_remote_retrieve_response_code($response) !== 201 || empty($data['checkoutUrl'])) {
            wc_add_notice('Payment error: ' . ($data['error'] ?? 'Failed to create escrow.'), 'error');
            return;
        }

        // Redirect to TrustLink checkout page
        return array(
            'result' => 'success',
            'redirect' => $data['checkoutUrl']
        );
    }
}

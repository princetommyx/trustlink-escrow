<?php
if (!defined('ABSPATH')) {
    exit;
}

class WC_Gateway_TrustLink extends WC_Payment_Gateway {

    public function __construct() {
        $this->id = 'trustlink_escrow';
        $this->icon = '';
        $this->has_fields = false;
        $this->method_title = 'TrustLink Escrow';
        $this->method_description = 'Allows secure escrow payments via TrustLink.';

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->api_key = $this->get_option('api_key');
        $this->api_url = esc_url_raw($this->get_option('api_url', 'https://www.trustlinkgh.online/api/v1/escrows'));
        
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
                'description' => 'Title displayed to customers during checkout.',
                'default' => 'TrustLink Escrow (Protected Mobile Money Payment)',
                'desc_tip' => true,
            ),
            'description' => array(
                'title' => 'Description',
                'type' => 'textarea',
                'description' => 'Description displayed to customers during checkout.',
                'default' => 'Pay securely via TrustLink Escrow. Your funds are held safely until you receive your order.',
            ),
            'api_key' => array(
                'title' => 'TrustLink API Key',
                'type' => 'password',
                'description' => 'Get this from your TrustLink Vendor Dashboard.',
                'default' => '',
            ),
            'api_url' => array(
                'title' => 'TrustLink API Endpoint URL',
                'type' => 'text',
                'description' => 'Target TrustLink API endpoint URL.',
                'default' => 'https://www.trustlinkgh.online/api/v1/escrows',
                'desc_tip' => true,
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

        $target_url = $this->api_url ? $this->api_url : 'https://www.trustlinkgh.online/api/v1/escrows';

        // Require HTTPS outside local development
        if (strpos($target_url, 'https://') !== 0 && strpos($target_url, 'localhost') === false && strpos($target_url, '127.0.0.1') === false) {
            wc_add_notice('Payment error: Secure HTTPS connection required for TrustLink API.', 'error');
            return;
        }

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

        $response = wp_remote_post($target_url, array(
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

        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($response_code !== 201 || empty($data['checkoutUrl'])) {
            $err_msg = isset($data['error']) ? sanitize_text_field($data['error']) : 'Failed to create payment checkout link.';
            wc_add_notice('Payment processing notice: ' . $err_msg, 'error');
            return;
        }

        return array(
            'result' => 'success',
            'redirect' => $data['checkoutUrl']
        );
    }
}

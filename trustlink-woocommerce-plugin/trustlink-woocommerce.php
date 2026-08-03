<?php
/**
 * Plugin Name: TrustLink Escrow for WooCommerce
 * Plugin URI: https://www.trustlinkgh.online
 * Description: Accept secure escrow payments on your WooCommerce store via TrustLink Escrow.
 * Version: 1.0.1
 * Author: TrustLink Escrow
 * Author URI: https://www.trustlinkgh.online
 * License: GPLv2 or later
 * Text Domain: trustlink-woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) {
    return;
}

add_action('plugins_loaded', 'trustlink_woocommerce_init', 0);

function trustlink_woocommerce_init() {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    require_once plugin_dir_path(__FILE__) . 'class-wc-gateway-trustlink.php';

    add_filter('woocommerce_payment_gateways', 'add_trustlink_gateway');
    function add_trustlink_gateway($methods) {
        $methods[] = 'WC_Gateway_TrustLink';
        return $methods;
    }
}

add_action('rest_api_init', function () {
    register_rest_route('trustlink/v1', '/webhook', array(
        'methods' => 'POST',
        'callback' => 'trustlink_webhook_handler',
        'permission_callback' => '__return_true'
    ));
});

function trustlink_webhook_handler(WP_REST_Request $request) {
    $payload = $request->get_json_params();
    $signature = $request->get_header('x_trustlink_signature');

    $settings = get_option('woocommerce_trustlink_settings');
    $api_key = $settings['api_key'] ?? '';

    if ($signature !== $api_key) {
        return new WP_Error('invalid_signature', 'Invalid signature', array('status' => 401));
    }

    $event = $payload['event'] ?? '';
    $data = $payload['data'] ?? array();
    $order_id = $data['customReference'] ?? '';
    $status = $data['status'] ?? '';

    if (!$order_id) {
        return new WP_Error('missing_order_id', 'Missing customReference', array('status' => 400));
    }

    $order = wc_get_order($order_id);
    if (!$order) {
        return new WP_Error('invalid_order', 'Order not found', array('status' => 404));
    }

    if ($event === 'escrow.status_changed') {
        if ($status === 'FUNDS_ESCROWED' || $status === 'FUNDED') {
            $order->payment_complete($data['id']);
            $order->add_order_note('TrustLink Escrow Secured. Please dispatch the item. Escrow ID: ' . $data['id']);
        } elseif ($status === 'COMPLETED') {
            $order->update_status('completed', 'TrustLink Escrow Completed and Funds Released.');
        } elseif ($status === 'DISPUTED') {
            $order->update_status('on-hold', 'TrustLink Escrow Disputed.');
        }
    }

    return new WP_REST_Response(array('success' => true), 200);
}

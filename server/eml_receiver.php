<?php
/*
 * eml_receiver.php — drop-in PHP handler for the "Save Message as EML"
 * extension. One language (PHP) for the whole receiving side.
 *
 * Run with the built-in server (no router file needed):
 *
 *     cd ~/eml-out
 *     php -S localhost:8765 eml_receiver.php
 *
 * (or copy it to index.php, or point your existing router at it).
 *
 * What it does:
 *   1. Answers the CORS preflight (OPTIONS) that Firefox/Thunderbird
 *      send when the host isn't covered by the extension's
 *      host_permissions. If you install v0.4.1+ of the extension, no
 *      preflight is sent at all and this branch simply never runs.
 *   2. On the real POST, reads the raw RFC 822 body (php://input),
 *      writes it to a .eml file next to this script, never overwriting
 *      (adds .1, .2, ... on collision), chmod 0600, and replies JSON.
 *
 * Contract from the extension (background.js):
 *   method        POST
 *   Content-Type  application/octet-stream
 *   body          raw message source (headers + body + attachments)
 *   headers       X-EML-Name, X-EML-Subject, X-EML-Message-Id
 * reply           200 + {"ok":true,"path":"<absolute path>"}
 *
 * Extend this file freely (routing, renaming, hooks, ...) — it is the
 * one server-side place all logic should live.
 */

// --- CORS: let the extension read the response / pass the preflight ---
header('Access-Control-Allow-Origin: *');

$method = $_SERVER['REQUEST_METHOD'] ?? '';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: '
         . 'content-type, x-eml-name, x-eml-subject, x-eml-message-id');
    header('Access-Control-Max-Age: 600');
    http_response_code(204);
    exit;
}

if ($method !== 'POST') {
    header('Allow: POST, OPTIONS');
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'use POST']);
    exit;
}

// --- Read the raw message ---
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'empty body']);
    exit;
}

// --- Pick a safe file name (basename only, *.eml, else timestamp) ---
$name = basename(trim((string)($_SERVER['HTTP_X_EML_NAME'] ?? '')));
if ($name === '' || !preg_match('/^[A-Za-z0-9._-]+\.eml$/i', $name)) {
    $name = date('Ymd_His') . '.eml';
}

$dir = __DIR__;
$target = $dir . '/' . $name;

// Never overwrite: add .1, .2, ... until the name is free.
if (file_exists($target)) {
    $base = preg_replace('/\.eml$/i', '', $name);
    for ($i = 1; file_exists($dir . "/{$base}.{$i}.eml"); $i++) {}
    $target = $dir . "/{$base}.{$i}.eml";
}

file_put_contents($target, $raw);
chmod($target, 0600);

header('Content-Type: application/json');
echo json_encode(['ok' => true, 'path' => $target]);

CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL DEFAULT 'greenhouse',
  capacity INT NOT NULL DEFAULT 0,
  description TEXT NULL,
  region VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(120) NULL UNIQUE,
  phone VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'operator',
  location_id INT NULL,
  avatar_path VARCHAR(255) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  jti CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  logged_out_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  INDEX idx_auth_sessions_user_id (user_id),
  INDEX idx_auth_sessions_jti (jti)
);

CREATE TABLE IF NOT EXISTS seedling_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rootstock_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS varieties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seedling_type_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (seedling_type_id) REFERENCES seedling_types(id)
    ON DELETE RESTRICT,
  INDEX idx_varieties_seedling_type_id (seedling_type_id)
);

CREATE TABLE IF NOT EXISTS seedling_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_code VARCHAR(80) NOT NULL UNIQUE,
  seedling_type_id INT NOT NULL,
  variety_id INT NOT NULL,
  rootstock_type_id INT NULL,
  source_location_id INT NOT NULL,
  received_date DATE NOT NULL,
  initial_quantity INT NOT NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (seedling_type_id) REFERENCES seedling_types(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (variety_id) REFERENCES varieties(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (rootstock_type_id) REFERENCES rootstock_types(id)
    ON DELETE SET NULL,
  FOREIGN KEY (source_location_id) REFERENCES locations(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_batches_source_location_id (source_location_id),
  INDEX idx_batches_variety_id (variety_id),
  INDEX idx_batches_rootstock_type_id (rootstock_type_id)
);

CREATE TABLE IF NOT EXISTS seedling_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  location_id INT NOT NULL,
  current_stage VARCHAR(50) NOT NULL DEFAULT 'received',
  quantity_available INT NOT NULL DEFAULT 0,
  defect_quantity INT NOT NULL DEFAULT 0,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES seedling_batches(id)
    ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE RESTRICT,
  UNIQUE KEY uq_inventory_batch_location (batch_id, location_id),
  INDEX idx_inventory_location_id (location_id),
  INDEX idx_inventory_stage (current_stage)
);

CREATE TABLE IF NOT EXISTS seedling_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  inventory_id INT NULL,
  action_type VARCHAR(50) NOT NULL,
  from_location_id INT NULL,
  to_location_id INT NULL,
  previous_stage VARCHAR(50) NULL,
  next_stage VARCHAR(50) NULL,
  quantity INT NOT NULL DEFAULT 0,
  defect_quantity INT NOT NULL DEFAULT 0,
  image_paths LONGTEXT NULL,
  stage_date DATETIME NULL,
  approval_status VARCHAR(30) NOT NULL DEFAULT 'approved',
  requires_approval TINYINT(1) NOT NULL DEFAULT 0,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  approval_note VARCHAR(255) NULL,
  reference_type VARCHAR(50) NULL,
  reference_id INT NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES seedling_batches(id)
    ON DELETE CASCADE,
  FOREIGN KEY (inventory_id) REFERENCES seedling_inventory(id)
    ON DELETE SET NULL,
  FOREIGN KEY (from_location_id) REFERENCES locations(id)
    ON DELETE SET NULL,
  FOREIGN KEY (to_location_id) REFERENCES locations(id)
    ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_history_batch_id (batch_id),
  INDEX idx_history_reference (reference_type, reference_id),
  INDEX idx_history_approval_status (approval_status)
);

CREATE TABLE IF NOT EXISTS transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_code VARCHAR(80) NOT NULL UNIQUE,
  batch_id INT NOT NULL,
  from_inventory_id INT NOT NULL,
  from_location_id INT NOT NULL,
  to_location_id INT NOT NULL,
  quantity INT NOT NULL,
  transfer_type VARCHAR(30) NOT NULL DEFAULT 'movement',
  transfer_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stage_on_transfer VARCHAR(50) NOT NULL,
  note TEXT NULL,
  notes TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_sender',
  created_by INT NULL,
  sender_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  sender_confirmed_by INT NULL,
  sender_confirmed_at DATETIME NULL,
  head_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  head_confirmed_by INT NULL,
  head_confirmed_at DATETIME NULL,
  receiver_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  receiver_confirmed_by INT NULL,
  receiver_confirmed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES seedling_batches(id)
    ON DELETE CASCADE,
  FOREIGN KEY (from_inventory_id) REFERENCES seedling_inventory(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (from_location_id) REFERENCES locations(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (to_location_id) REFERENCES locations(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (sender_confirmed_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (head_confirmed_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (receiver_confirmed_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_transfers_status (status),
  INDEX idx_transfers_batch_id (batch_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(80) NOT NULL UNIQUE,
  client_name VARCHAR(120) NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(40) NULL,
  location_id INT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  order_date DATETIME NULL,
  note TEXT NULL,
  notes TEXT NULL,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_quantity INT NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 0,
  fulfilled_quantity INT NOT NULL DEFAULT 0,
  shortage_quantity INT NOT NULL DEFAULT 0,
  batch_id INT NULL,
  seedling_type_id INT NULL,
  variety_id INT NULL,
  created_by INT NULL,
  sold_by INT NULL,
  sold_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (sold_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_orders_status (status),
  INDEX idx_orders_location_id (location_id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  batch_id INT NOT NULL,
  inventory_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES seedling_batches(id)
    ON DELETE RESTRICT,
  FOREIGN KEY (inventory_id) REFERENCES seedling_inventory(id)
    ON DELETE RESTRICT,
  INDEX idx_order_items_order_id (order_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  location_id INT NULL,
  assigned_to INT NULL,
  created_by INT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  priority VARCHAR(30) NOT NULL DEFAULT 'medium',
  due_date DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_priority (priority)
);

CREATE TABLE IF NOT EXISTS customer_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  price DECIMAL(14,2) NOT NULL DEFAULT 0,
  image_path VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_customer_products_active (is_active, display_order, id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  title VARCHAR(160) NOT NULL,
  message VARCHAR(255) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id INT NULL,
  location_id INT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id)
    ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_notifications_recipient (recipient_user_id, is_read, created_at),
  INDEX idx_notifications_entity (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_activity_created_at (created_at),
  INDEX idx_activity_entity (entity_type, entity_id)
);

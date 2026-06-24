-- 1) ms_property_category
CREATE TABLE `ms_property_category` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 2) ms_brand
CREATE TABLE `ms_brand` (
  `id` int NOT NULL AUTO_INCREMENT,
  `brand_name` varchar(255) NOT NULL,
  `logo_image` varchar(255) NOT NULL,
  `sort_order` int NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brand_name` (`brand_name`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 3) tb_hotel
CREATE TABLE `tb_hotel` (
  `id` int NOT NULL AUTO_INCREMENT,
  `property_category` int NOT NULL,
  `property_brand` int NULL,
  `role` int NOT NULL COMMENT '1 = operator ; 2 = hotel',
  `code` varchar(100) NOT NULL,
  `name` varchar(100) NOT NULL,
  `status` int NOT NULL DEFAULT 0 COMMENT '0 = Draft, 1 = Live',
  `be_comission` decimal(4,2) NULL DEFAULT 0.00,
  `be_pay_at_hotel` int NOT NULL COMMENT '0=off, 1=on',
  `region` varchar(255) NOT NULL,
  `area` varchar(100) NOT NULL,
  `street_address` text NOT NULL,
  `zip_code` varchar(255) NULL,
  `hotel_star` int NULL,
  `phone` varchar(255) NULL,
  `wa_number` bigint NULL,
  `email_hotel` varchar(255) NULL,
  `email_quota_month` int NOT NULL,
  `email_send_month` int NOT NULL,
  `precheckin_send_mail` int NOT NULL,
  `checkin_send_mail` int NOT NULL,
  `checkout_send_mail` int NOT NULL,
  `on_booking_send_email` int NULL,
  `on_payment_send_email` int NULL,
  `web_link` varchar(255) NULL,
  `fb_link` varchar(255) NULL,
  `ig_link` varchar(255) NULL,
  `tiktok_link` varchar(255) NULL,
  `yt_link` varchar(255) NULL,
  `twitter_link` varchar(255) NULL,
  `map_link` varchar(255) NULL,
  `title` varchar(255) NULL,
  `description` text NULL,
  `crm` int NOT NULL,
  `loyalty` int NOT NULL,
  `be` int NOT NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `latitude` varchar(255) NULL,
  `longitude` varchar(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 4) tb_hotel_image
CREATE TABLE `tb_hotel_image` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hotel_id` int NOT NULL,
  `room_type_id` int NULL,
  `type` int NOT NULL COMMENT '0= Hotel Gallery, 1=Room Gallery',
  `main_image` int NOT NULL DEFAULT 0,
  `description` text NULL,
  `filename` varchar(255) NULL,
  `sort_order` int NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 5) tb_hotel_room_type
CREATE TABLE `tb_hotel_room_type` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hotel_id` int NOT NULL,
  `hotel_code` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `room_qty` int NOT NULL,
  `room_available` int NOT NULL,
  `cut_off_day` int NOT NULL,
  `min_rate` float NOT NULL,
  `view` varchar(255) NOT NULL,
  `room_size` float NOT NULL,
  `smoking` int NOT NULL,
  `bathroom` int NOT NULL,
  `guest` int NOT NULL,
  `extra_guest` int NOT NULL,
  `bed_type` varchar(255) NULL,
  `bed_qty` int NULL,
  `status` int NOT NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 6) tb_hotel_rate_plan
CREATE TABLE `tb_hotel_rate_plan` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hotel_id` int NOT NULL,
  `room_type_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text NULL,
  `rate` float NOT NULL,
  `min_rate` float NOT NULL,
  `min_night` int NOT NULL,
  `extra_adult_charge` float NULL,
  `food` int NOT NULL,
  `food_pack` int NULL,
  `food_desc` varchar(255) NOT NULL,
  `cancelation_policy` int NOT NULL,
  `deposit_policy` int NOT NULL,
  `status` int NOT NULL,
  `pay_at_hotel` int NOT NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 7) tb_hotel_rate_custom
CREATE TABLE `tb_hotel_rate_custom` (
  `date` date NOT NULL,
  `rate_plan_id` int NOT NULL,
  `room_qty` int NULL,
  `rate` float NULL,
  `stop_sell` int NULL DEFAULT 0,
  `cta` int NULL DEFAULT 0,
  `ctd` int NULL DEFAULT 0,
  `min_stay` int NULL,
  `pay_at_hotel` int NULL,
  `create_user` varchar(255) NOT NULL,
  `create_date` datetime NOT NULL,
  `update_user` varchar(255) NOT NULL,
  `update_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`date`, `rate_plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- 8) tb_hotel_calendar_inventory (Flat Table for push)
CREATE TABLE `tb_hotel_calendar_inventory` (
  `hotel_id` int NOT NULL,
  `hotel_code` varchar(100) NOT NULL,
  `room_type_id` int NOT NULL,
  `rate_plan_id` int NOT NULL,
  `date` date NOT NULL,
  `total_amount_after_tax` decimal(10,2) NOT NULL,
  `inv_count` int NOT NULL,
  `restriction_master` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1=Open, 0=Close',
  `restriction_arrival` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1=Open, 0=Close',
  `restriction_departure` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1=Open, 0=Close',
  `set_min_los` int NOT NULL,
  PRIMARY KEY (`hotel_code`, `room_type_id`, `rate_plan_id`, `date`),
  INDEX `date_idx` (`date`),
  INDEX `hotel_date_idx` (`hotel_code`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

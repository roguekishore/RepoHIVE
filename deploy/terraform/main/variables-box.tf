# Settings of the app box. The memory limit and heap are unmeasured defaults.

variable "box_root_volume_gb" {
  type        = number
  description = "Size of the encrypted gp3 root volume. Root and data volumes together stay within 30 GB."
  default     = 12

  validation {
    condition     = var.box_root_volume_gb >= 8 && var.box_root_volume_gb + var.box_data_volume_gb <= 30
    error_message = "box_root_volume_gb must be at least 8, and the root and data volumes together at most 30 GB."
  }
}

variable "box_data_volume_gb" {
  type        = number
  description = "Size of the encrypted gp3 volume that holds SQLite data at /var/lib/repohive."
  default     = 8

  validation {
    condition     = var.box_data_volume_gb >= 1
    error_message = "box_data_volume_gb must be at least 1."
  }
}

variable "server_memory_max_mb" {
  type        = number
  description = "systemd MemoryMax of repohive-server, in MB. It covers the JVM and the pre-check's Node child process."
  default     = 1280
}

variable "server_heap_mb" {
  type        = number
  description = "JVM -Xmx of repohive-server, in MB. Keep it well below server_memory_max_mb: metaspace, thread stacks and the pre-check child come on top."
  default     = 512

  validation {
    condition     = var.server_heap_mb + 384 <= var.server_memory_max_mb
    error_message = "server_heap_mb must leave at least 384 MB of server_memory_max_mb for the JVM's own memory and the pre-check child."
  }
}

variable "admin_origins" {
  type        = list(string)
  description = "Origins allowed to call /api/admin/** from a browser (the owner's quota page), for example [\"https://hivequota.themaverick.tech\"]. Empty allows none. The admin API itself stays off until deploy/scripts/put-admin-token.sh has stored a token."
  default     = []

  validation {
    condition     = alltrue([for o in var.admin_origins : can(regex("^https://[a-z0-9.-]+(:[0-9]+)?$", o))])
    error_message = "Every admin origin must be an https origin in lower case with no path, such as https://example.com."
  }
}

variable "caddy_rate_limit_per_minute" {
  type        = number
  description = "Caddy backstop: requests a minute from one client address, over all paths."
  default     = 300

  validation {
    condition     = var.caddy_rate_limit_per_minute >= 1
    error_message = "caddy_rate_limit_per_minute must be at least 1."
  }
}

variable "caddy_rate_limit_api_post_per_minute" {
  type        = number
  description = "Caddy backstop: POST requests a minute from one client address under /api/."
  default     = 30

  validation {
    condition     = var.caddy_rate_limit_api_post_per_minute >= 1
    error_message = "caddy_rate_limit_api_post_per_minute must be at least 1."
  }
}

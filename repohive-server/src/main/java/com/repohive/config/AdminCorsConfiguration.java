package com.repohive.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Cross-origin access to the admin API for the pages in {@code REPOHIVE_ADMIN_ORIGINS} and for no one else. With the
 * list empty nothing is registered, so a browser on any other origin is refused (a cross-origin request from an origin
 * that is not listed gets a 403 from Spring, before the controller).
 */
@Configuration(proxyBeanMethods = false)
public class AdminCorsConfiguration implements WebMvcConfigurer {

    private final AppConfig config;

    public AdminCorsConfiguration(AppConfig config) {
        this.config = config;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (config.adminToken() == null || config.adminOrigins().isEmpty()) {
            return;
        }
        registry.addMapping("/api/admin/**")
                .allowedOrigins(config.adminOrigins().toArray(String[]::new))
                .allowedMethods("GET", "PUT", "DELETE")
                .allowedHeaders("Authorization", "Content-Type")
                .allowCredentials(false)
                .maxAge(600);
    }
}

package com.example.app;

import com.example.model.User;
import com.example.service.UserService;

/**
 * Application entry point. Imports both a model type and the service type,
 * yielding cross-package edges from this file to the resolved classes.
 */
public class Main {
    public static void main(String[] args) {
        UserService service = new UserService();
        User user = service.create("ada", 1L);
        System.out.println(user.getName());
    }
}

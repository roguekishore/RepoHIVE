package com.example;

import com.example.service.UserService;

/**
 * A source file located directly in the project root, so its nodes carry an
 * empty-string directoryPath (R3.6) while still declaring a package. Imports the
 * service type to produce a resolved cross-file edge from the root file.
 */
public class Bootstrap {
    public static void main(String[] args) {
        UserService service = new UserService();
        System.out.println(service.getClass().getName());
    }
}

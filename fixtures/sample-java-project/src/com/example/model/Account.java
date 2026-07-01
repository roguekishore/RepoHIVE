package com.example.model;

/**
 * A second model type in the same package. Referenced by the service layer to
 * produce another cross-package edge.
 */
public class Account {
    private final User owner;
    private double balance;

    public Account(User owner) {
        this.owner = owner;
        this.balance = 0.0;
    }

    public User getOwner() {
        return owner;
    }

    public double getBalance() {
        return balance;
    }

    public void deposit(double amount) {
        this.balance += amount;
    }
}
